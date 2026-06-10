import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Data, Effect } from "effect";
import { throttle } from "es-toolkit";
import type { CompressionMode, RepositoryConfig } from "../schemas";
import { type ResticBackupProgressDto, resticBackupOutputSchema, resticBackupProgressSchema } from "../restic-dto";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { validateCustomResticParams } from "../helpers/validate-custom-params";
import { createResticError, isResticError } from "../error";
import { logger, safeSpawn } from "../../node";
import type { ResticDeps } from "../types";
import { hasPathListSeparator, toMessage } from "../../utils";

class ResticBackupCommandError extends Data.TaggedError("ResticBackupCommandError")<{
	cause: unknown;
	message: string;
}> {}

const validateEntries = (entries: string[], optionName: string, format: "raw" | "text") => {
	for (const entry of entries) {
		if (hasPathListSeparator(entry, format)) {
			throw new Error(`${optionName} contains an unsupported path character: ${entry}`);
		}
	}
};

export const backup = (
	config: RepositoryConfig,
	source: string,
	options: {
		organizationId: string;
		exclude?: string[];
		excludeIfPresent?: string[];
		includePaths?: string[];
		includePatterns?: string[];
		tags?: string[];
		oneFileSystem?: boolean;
		compressionMode?: CompressionMode;
		signal?: AbortSignal;
		onProgress?: (progress: ResticBackupProgressDto) => void;
		customResticParams?: string[];
	},
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);

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
			let rawIncludeFile: string | null = null;
			const usesSourceArg =
				(!options.includePaths || options.includePaths.length === 0) &&
				(!options.includePatterns || options.includePatterns.length === 0);

			if (options.includePatterns?.length) {
				validateEntries(options.includePatterns, "includePatterns", "text");

				const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-include-"));
				includeFile = path.join(tmp, "include.txt");

				await fs.writeFile(includeFile, options.includePatterns.join("\n"), "utf-8");

				args.push("--files-from", includeFile);
			}

			if (options.includePaths?.length) {
				validateEntries(options.includePaths, "includePaths", "raw");

				const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-include-raw-"));
				rawIncludeFile = path.join(tmp, "include.raw");

				await fs.writeFile(rawIncludeFile, Buffer.from(`${options.includePaths.join("\0")}\0`, "utf-8"));

				args.push("--files-from-raw", rawIncludeFile);
			}

			for (const exclude of deps.defaultExcludes) {
				args.push("--exclude", exclude);
			}

			let excludeFile: string | null = null;
			if (options.exclude?.length) {
				const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-restic-exclude-"));
				excludeFile = path.join(tmp, "exclude.txt");

				await fs.writeFile(excludeFile, options.exclude.join("\n"), "utf-8");

				args.push("--exclude-file", excludeFile);
			}

			if (options.excludeIfPresent?.length) {
				for (const filename of options.excludeIfPresent) {
					args.push("--exclude-if-present", filename);
				}
			}

			if (options.customResticParams?.length) {
				const validationError = validateCustomResticParams(options.customResticParams);
				if (validationError) {
					throw new Error(`Invalid customResticParams: ${validationError}`);
				}
				for (const param of options.customResticParams) {
					const tokens = param.trim().split(/\s+/).filter(Boolean);
					args.push(...tokens);
				}
			}

			const env = await buildEnv(config, options.organizationId, deps);
			addCommonArgs(args, env, config);

			if (usesSourceArg) {
				args.push("--", source);
			}

			const stderrLines: string[] = [];
			const logData = throttle((data: string) => {
				logger.info(data.trim());
			}, 5000);

			logger.debug(`Executing: restic ${args.join(" ")}`);
			const res = await safeSpawn({
				command: "restic",
				args,
				env: { ...env, RESTIC_PROGRESS_FPS: "1" },
				signal: options.signal,
				onStdout: (data) => {
					logData(data);
					if (!options.onProgress) {
						return;
					}

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
				},
				onStderr: (error) => {
					const line = error.trim();
					if (line.length > 0) {
						stderrLines.push(line);
						logger.error(`restic stderr: ${line}`);
					}
				},
			});

			const stderrDetails = stderrLines.length > 0 ? stderrLines.join("\n") : null;
			const warningDetails = res.exitCode === 0 ? null : stderrDetails;

			if (includeFile) {
				await fs.unlink(includeFile).catch(() => {});
			}
			if (rawIncludeFile) {
				await fs.unlink(rawIncludeFile).catch(() => {});
			}
			if (excludeFile) {
				await fs.unlink(excludeFile).catch(() => {});
			}
			await cleanupTemporaryKeys(env, deps);

			if (options.signal?.aborted) {
				logger.warn("Restic backup was aborted by signal.");
				return { result: null, exitCode: res.exitCode, warningDetails: "Backup was stopped by the user" };
			}

			if (res.exitCode === 3) {
				logger.error(`Restic backup encountered read errors: ${res.error}`);
			}

			if (res.exitCode !== 0 && res.exitCode !== 3) {
				logger.error(`Restic backup failed: ${res.error}`);
				logger.error(`Command executed: restic ${args.join(" ")}`);

				throw createResticError(res.exitCode, stderrDetails || res.stderr || res.error);
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
				return {
					result: null,
					exitCode: res.exitCode,
					warningDetails,
				};
			}

			return {
				result: result.data,
				exitCode: res.exitCode,
				warningDetails,
			};
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticBackupCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
