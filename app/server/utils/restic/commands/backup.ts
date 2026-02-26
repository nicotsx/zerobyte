import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type } from "arktype";
import { throttle } from "es-toolkit";
import type { CompressionMode, RepositoryConfig } from "~/schemas/restic";
import {
	type ResticBackupProgressDto,
	resticBackupOutputSchema,
	resticBackupProgressSchema,
} from "~/schemas/restic-dto";
import { DEFAULT_EXCLUDES } from "~/server/core/constants";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeSpawn } from "~/server/utils/spawn";
import { config as appConfig } from "~/server/core/config";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

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
	},
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args: string[] = ["--repo", repoUrl, "backup", "--compression", options.compressionMode ?? "auto"];

	if (options.oneFileSystem) {
		args.push("--one-file-system");
	}

	if (appConfig.resticHostname) {
		args.push("--host", appConfig.resticHostname);
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

	for (const exclude of DEFAULT_EXCLUDES) {
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

	addCommonArgs(args, env, config);

	const logData = throttle((data: string) => {
		logger.info(data.trim());
	}, 5000);

	const streamProgress = throttle((data: string) => {
		if (options.onProgress) {
			try {
				const jsonData = JSON.parse(data);
				const progress = resticBackupProgressSchema(jsonData);
				if (!(progress instanceof type.errors)) {
					options.onProgress(progress);
				} else {
					logger.error(progress.summary);
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
	await cleanupTemporaryKeys(env);

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
	const result = resticBackupOutputSchema(summaryLine);

	if (result instanceof type.errors) {
		logger.error(`Restic backup output validation failed: ${result.summary}`);
		return { result: null, exitCode: res.exitCode };
	}

	return { result, exitCode: res.exitCode };
};
