import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { throttle } from "es-toolkit";
import type { CompressionMode, RepositoryConfig } from "../schemas";
import { type ResticBackupProgressDto, resticBackupOutputSchema, resticBackupProgressSchema } from "../restic-dto";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { validateCustomResticParams } from "../helpers/validate-custom-params";
import { ResticError } from "../error";
import { logger, safeSpawn } from "../../node";
import type { ResticDeps } from "../types";

export const backup = async (
	config: RepositoryConfig,
	source: string,
	options: {
		organizationId: string;
		exclude?: string[];
		excludeIfPresent?: string[];
		include?: string[];
		tags?: string[];
		oneFileSystem?: boolean;
		compressionMode?: CompressionMode;
		signal?: AbortSignal;
		onProgress?: (progress: ResticBackupProgressDto) => void;
		customResticParams?: string[];
	},
	deps: ResticDeps,
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId, deps);

	const args: string[] = ["--repo", repoUrl, "backup", "--compression", options.compressionMode ?? "auto"];

	if (options.oneFileSystem) {
		args.push("--one-file-system");
	}

	if (deps.hostname) {
		args.push("--host", deps.hostname);
	}

	if (options.tags && options.tags.length > 0) {
		for (const tag of options.tags) {
			args.push("--tag", tag);
		}
	}

	let includeFile: string | null = null;
	if (options.include && options.include.length > 0) {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-include-"));
		includeFile = path.join(tmp, "include.txt");

		await fs.writeFile(includeFile, options.include.join("\n"), "utf-8");

		args.push("--files-from", includeFile);
	} else {
		args.push(source);
	}

	for (const exclude of deps.defaultExcludes) {
		args.push("--exclude", exclude);
	}

	let excludeFile: string | null = null;
	if (options.exclude && options.exclude.length > 0) {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-exclude-"));
		excludeFile = path.join(tmp, "exclude.txt");

		await fs.writeFile(excludeFile, options.exclude.join("\n"), "utf-8");

		args.push("--exclude-file", excludeFile);
	}

	if (options.excludeIfPresent && options.excludeIfPresent.length > 0) {
		for (const filename of options.excludeIfPresent) {
			args.push("--exclude-if-present", filename);
		}
	}

	if (options.customResticParams && options.customResticParams.length > 0) {
		const validationError = validateCustomResticParams(options.customResticParams);
		if (validationError) {
			throw new Error(`Invalid customResticParams: ${validationError}`);
		}
		for (const param of options.customResticParams) {
			const tokens = param.trim().split(/\s+/).filter(Boolean);
			args.push(...tokens);
		}
	}

	addCommonArgs(args, env, config);

	const logData = throttle((data: string) => {
		logger.info(data.trim());
	}, 5000);

	const streamProgress = throttle((data: string) => {
		if (options.onProgress) {
			try {
				const jsonData = JSON.parse(data);
				if (jsonData.message_type !== "status") {
					return;
				}

				const progressResult = resticBackupProgressSchema.safeParse(jsonData);
				if (progressResult.success) {
					options.onProgress(progressResult.data);
				} else {
					logger.error(progressResult.error.message);
				}
			} catch {
				// Ignore JSON parse errors for non-JSON lines
			}
		}
	}, 1000);

	logger.debug(`Executing: restic ${args.join(" ")}`);
	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		signal: options.signal,
		onStdout: (data) => {
			logData(data);
			if (options.onProgress) {
				streamProgress(data);
			}
		},
	});

	if (includeFile) {
		await fs.unlink(includeFile).catch(() => {});
	}
	if (excludeFile) {
		await fs.unlink(excludeFile).catch(() => {});
	}
	await cleanupTemporaryKeys(env, deps);

	if (options.signal?.aborted) {
		logger.warn("Restic backup was aborted by signal.");
		return { result: null, exitCode: res.exitCode };
	}

	if (res.exitCode === 3) {
		logger.error(`Restic backup encountered read errors: ${res.error}`);
	}

	if (res.exitCode !== 0 && res.exitCode !== 3) {
		logger.error(`Restic backup failed: ${res.error}`);
		logger.error(`Command executed: restic ${args.join(" ")}`);

		throw new ResticError(res.exitCode, res.error);
	}

	const lastLine = res.summary.trim();
	let summaryLine: unknown = {};
	try {
		summaryLine = JSON.parse(lastLine ?? "{}");
	} catch {
		logger.warn("Failed to parse restic backup output JSON summary.", lastLine);
		summaryLine = {};
	}

	logger.debug(`Restic backup output last line: ${JSON.stringify(summaryLine)}`);
	const result = resticBackupOutputSchema.safeParse(summaryLine);

	if (!result.success) {
		logger.error(`Restic backup output validation failed: ${result.error.message}`);
		return { result: null, exitCode: res.exitCode };
	}

	return { result: result.data, exitCode: res.exitCode };
};
