import { formatBandwidthLimit } from "../helpers/bandwidth";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import { createResticError, isResticError } from "../error";
import { logger, safeExec } from "../../node";
import type { ResticDeps } from "../types";
import { Data, Effect } from "effect";
import { toMessage } from "../../utils";

class ResticCopyCommandError extends Data.TaggedError("ResticCopyCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const copy = (
	sourceConfig: RepositoryConfig,
	destConfig: RepositoryConfig,
	options: { organizationId: string; tag?: string; snapshotIds?: string[]; signal?: AbortSignal },
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const sourceRepoUrl = buildRepoUrl(sourceConfig);
			const destRepoUrl = buildRepoUrl(destConfig);

			const sourceEnv = await buildEnv(sourceConfig, options.organizationId, deps);
			const destEnv = await buildEnv(destConfig, options.organizationId, deps);

			const env: Record<string, string> = {
				...sourceEnv,
				...destEnv,
				RESTIC_FROM_PASSWORD_FILE: sourceEnv.RESTIC_PASSWORD_FILE!,
			};

			const args: string[] = ["--repo", destRepoUrl, "copy", "--from-repo", sourceRepoUrl];

			if (options.tag) {
				args.push("--tag", options.tag);
			}

			addCommonArgs(args, env, destConfig, { skipBandwidth: true });

			const sourceDownloadLimit = formatBandwidthLimit(sourceConfig.downloadLimit);
			const destUploadLimit = formatBandwidthLimit(destConfig.uploadLimit);

			if (sourceDownloadLimit) {
				args.push("--limit-download", sourceDownloadLimit);
			}

			if (destUploadLimit) {
				args.push("--limit-upload", destUploadLimit);
			}

			if (options.snapshotIds && options.snapshotIds.length > 0) {
				args.push("--", ...options.snapshotIds);
			} else {
				args.push("--", "latest");
			}

			logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
			logger.debug(`Executing: restic ${args.join(" ")}`);

			let res: Awaited<ReturnType<typeof safeExec>>;
			try {
				res = await safeExec({ command: "restic", args, env, signal: options.signal });
			} finally {
				await cleanupTemporaryKeys(sourceEnv, deps);
				await cleanupTemporaryKeys(destEnv, deps);
			}

			const { stdout, stderr } = res;

			if (res.exitCode !== 0) {
				if (options.signal?.aborted) {
					logger.warn("Restic copy was aborted by signal.");
					throw new Error("Operation aborted");
				}

				logger.error(`Restic copy failed: ${stderr}`);
				throw createResticError(res.exitCode, stderr);
			}

			logger.info(`Restic copy completed from ${sourceRepoUrl} to ${destRepoUrl}`);
			return {
				success: true,
				output: stdout,
			};
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticCopyCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
