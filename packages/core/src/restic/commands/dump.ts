import { normalizeAbsolutePath } from "../../utils/path";
import type { Readable } from "node:stream";
import type { ResticDeps } from "../types";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import { logger, safeSpawn } from "../../node";
import { createResticError, isResticError } from "../error";
import { Data, Effect } from "effect";
import { toMessage } from "../../utils";

class ResticDumpCommandError extends Data.TaggedError("ResticDumpCommandError")<{
	cause: unknown;
	message: string;
}> {}

const normalizeDumpPath = (pathToDump?: string): string => {
	const trimmedPath = pathToDump?.trim();
	if (!trimmedPath) {
		return "/";
	}

	return normalizeAbsolutePath(trimmedPath);
};

export const dump = (
	config: RepositoryConfig,
	snapshotRef: string,
	options: {
		organizationId: string;
		path?: string;
		archive?: false;
	},
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);
			const pathToDump = normalizeDumpPath(options.path);

			const args: string[] = ["--repo", repoUrl, "dump"];

			if (options.archive !== false) {
				args.push("--archive", "tar");
			}

			addCommonArgs(args, env, config, { includeJson: false });
			args.push("--", snapshotRef, pathToDump);

			logger.debug(`Executing: restic ${args.join(" ")}`);

			let didCleanup = false;
			const cleanup = async () => {
				if (didCleanup) {
					return;
				}

				didCleanup = true;
				await cleanupTemporaryKeys(env, deps);
			};

			let stream: Readable | null = null;
			let abortController: AbortController | null = new AbortController();

			const maxStderrChars = 64 * 1024;
			let stderrTail = "";

			const completion = safeSpawn({
				command: deps.resticCommand ?? "restic",
				args,
				env,
				signal: abortController.signal,
				stdoutMode: "raw",
				onSpawn: (child) => {
					stream = child.stdout;
				},
				onStderr: (line) => {
					const chunk = line.trim();
					if (chunk) {
						stderrTail += `${line}\n`;
						if (stderrTail.length > maxStderrChars) {
							stderrTail = stderrTail.slice(-maxStderrChars);
						}
					}
				},
			})
				.then((result) => {
					if (result.exitCode === 0) {
						return;
					}

					const stderr = stderrTail.trim() || result.error;
					logger.error(`Restic dump failed: ${stderr}`);
					throw createResticError(result.exitCode, stderr);
				})
				.finally(async () => {
					abortController = null;
					await cleanup();
				});

			completion.catch(() => {});
			const completionPromise = new Promise<void>((resolve, reject) => completion.then(resolve, reject));

			if (!stream) {
				await cleanup();
				throw new Error("Failed to initialize restic dump stream");
			}

			return {
				stream,
				completion: completionPromise,
				abort: () => {
					if (abortController) {
						abortController.abort();
					}
				},
			};
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticDumpCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
