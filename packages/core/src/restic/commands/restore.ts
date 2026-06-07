import path from "node:path";
import { findCommonAncestor } from "../../utils/common-ancestor";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { type RepositoryConfig, type OverwriteMode } from "../schemas";
import { logger, safeSpawn } from "../../node";
import { createResticError, isResticError, type AnyResticError } from "../error";
import {
	restoreProgressSchema,
	resticRestoreOutputSchema,
	type RestoreProgress,
	type ResticRestoreOutputDto,
} from "../restic-dto";
import type { ResticDeps } from "../types";
import { Data, Effect } from "effect";
import { toMessage } from "../../utils";

class ResticRestoreCommandError extends Data.TaggedError("ResticRestoreCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const restore = (
	config: RepositoryConfig,
	snapshotId: string,
	target: string,
	options: {
		basePath?: string;
		organizationId: string;
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
		onProgress?: (progress: RestoreProgress) => void;
		signal?: AbortSignal;
	},
	deps: ResticDeps,
): Effect.Effect<ResticRestoreOutputDto, AnyResticError | ResticRestoreCommandError> => {
	return Effect.scoped(
		Effect.gen(function* () {
			const repoUrl = yield* Effect.try(() => buildRepoUrl(config));
			const env = yield* Effect.acquireRelease(
				Effect.tryPromise(() => buildEnv(config, options.organizationId, deps)),
				(env) => Effect.promise(() => cleanupTemporaryKeys(env, deps)),
			);

			const includes = options.include?.length ? options.include : [options.basePath ?? "/"];
			const commonAncestor =
				options.selectedItemKind === "file" && includes.length === 1
					? path.posix.dirname(includes[0] ?? "/")
					: findCommonAncestor(includes);
			const restoreArg = target === "/" ? snapshotId : `${snapshotId}:${commonAncestor}`;

			const args = ["--repo", repoUrl, "restore", "--target", target];

			if (options.overwrite) {
				args.push("--overwrite", options.overwrite);
			}

			if (options.include?.length) {
				if (target === "/") {
					for (const pattern of options.include) {
						args.push("--include", pattern);
					}
				} else {
					const strippedIncludes = options.include.map((pattern) =>
						path.posix.relative(commonAncestor, pattern),
					);
					const includesCoverRestoreRoot = strippedIncludes.some(
						(pattern) => pattern === "" || pattern === ".",
					);

					if (!includesCoverRestoreRoot) {
						for (const pattern of strippedIncludes) {
							args.push("--include", pattern);
						}
					}
				}
			}

			if (options.exclude?.length) {
				for (const pattern of options.exclude) {
					args.push("--exclude", pattern);
				}
			}

			if (options.excludeXattr?.length) {
				for (const xattr of options.excludeXattr) {
					args.push("--exclude-xattr", xattr);
				}
			}

			addCommonArgs(args, env, config);
			args.push("--", restoreArg);

			const onProgress = options.onProgress;

			logger.debug(`Executing: restic ${args.join(" ")}`);
			const res = yield* Effect.tryPromise(() =>
				safeSpawn({
					command: "restic",
					args,
					env: { ...env, RESTIC_PROGRESS_FPS: "1" },
					signal: options.signal,
					onStdout: (data) => {
						if (!onProgress) {
							return;
						}

						try {
							const jsonData = JSON.parse(data);
							if (jsonData.message_type !== "status") {
								return;
							}

							const progress = restoreProgressSchema.safeParse(jsonData);
							if (progress.success) {
								onProgress(progress.data);
							} else {
								logger.error(progress.error.message);
							}
						} catch {
							// Ignore JSON parse errors for non-JSON lines
						}
					},
				}),
			);

			if (res.exitCode !== 0) {
				logger.error(`Restic restore failed: ${res.error}`);
				return yield* Effect.fail(createResticError(res.exitCode, res.stderr || res.error));
			}

			const lastLine = res.summary.trim();
			let summaryLine: unknown = {};
			try {
				summaryLine = JSON.parse(lastLine);
			} catch {
				logger.warn("Failed to parse restic restore output JSON summary.", lastLine);
				summaryLine = {};
			}

			logger.debug(`Restic restore output last line: ${JSON.stringify(summaryLine)}`);
			const result = resticRestoreOutputSchema.safeParse(summaryLine);

			if (!result.success) {
				logger.warn(`Restic restore output validation failed: ${result.error.message}`);
				logger.info(`Restic restore completed for snapshot ${snapshotId} to target ${target}`);
				const fallback: ResticRestoreOutputDto = {
					message_type: "summary" as const,
					total_files: 0,
					files_restored: 0,
					files_skipped: 0,
					bytes_skipped: 0,
				};

				return fallback;
			}

			logger.info(
				`Restic restore completed for snapshot ${snapshotId} to target ${target}: ${result.data.files_restored} restored, ${result.data.files_skipped} skipped`,
			);

			return result.data;
		}).pipe(
			Effect.catchAll((error): Effect.Effect<never, AnyResticError | ResticRestoreCommandError> => {
				if (isResticError(error)) {
					return Effect.fail(error);
				}

				return Effect.fail(
					new ResticRestoreCommandError({
						cause: error,
						message: toMessage(error),
					}),
				);
			}),
		),
	);
};
