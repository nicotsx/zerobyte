import { formatBandwidthLimit } from "../helpers/bandwidth";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { getCopyCompatibleCustomResticParams } from "../helpers/validate-custom-params";
import type { RepositoryConfig } from "../schemas";
import { createResticError, isResticError, type AnyResticError } from "../error";
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
	options: {
		organizationId: string;
		tag?: string;
		snapshotIds?: string[];
		customResticParams?: string[];
		signal?: AbortSignal;
	},
	deps: ResticDeps,
) => {
	return Effect.scoped(
		Effect.gen(function* () {
			const sourceRepoUrl = yield* Effect.try(() => buildRepoUrl(sourceConfig));
			const destRepoUrl = yield* Effect.try(() => buildRepoUrl(destConfig));
			const sourceEnv = yield* Effect.acquireRelease(
				Effect.tryPromise(() => buildEnv(sourceConfig, options.organizationId, deps)),
				(env) => Effect.promise(() => cleanupTemporaryKeys(env, deps)),
			);
			const destEnv = yield* Effect.acquireRelease(
				Effect.tryPromise(() => buildEnv(destConfig, options.organizationId, deps)),
				(env) => Effect.promise(() => cleanupTemporaryKeys(env, deps)),
			);

			const env: Record<string, string> = {
				...sourceEnv,
				...destEnv,
				RESTIC_FROM_PASSWORD_FILE: sourceEnv.RESTIC_PASSWORD_FILE!,
			};
			const args: string[] = ["--repo", destRepoUrl, "copy", "--from-repo", sourceRepoUrl];

			if (options.tag) {
				args.push("--tag", options.tag);
			}

			if (options.customResticParams?.length) {
				const customResticParams = getCopyCompatibleCustomResticParams(options.customResticParams);
				for (const param of customResticParams) {
					const tokens = param.trim().split(/\s+/).filter(Boolean);
					args.push(...tokens);
				}
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
			if (options.snapshotIds?.length) {
				args.push("--", ...options.snapshotIds);
			} else {
				args.push("--", "latest");
			}

			logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
			logger.debug(`Executing: restic ${args.join(" ")}`);
			const res = yield* Effect.tryPromise(() =>
				safeExec({
					command: deps.resticCommand ?? "restic",
					args,
					env,
					signal: options.signal,
				}),
			);

			if (res.exitCode !== 0) {
				logger.error(`Restic copy failed: ${res.stderr}`);
				return yield* Effect.fail(createResticError(res.exitCode, res.stderr));
			}

			logger.info(`Restic copy completed from ${sourceRepoUrl} to ${destRepoUrl}`);
			return { success: true, output: res.stdout };
		}).pipe(
			Effect.catchAll((error): Effect.Effect<never, AnyResticError | ResticCopyCommandError> => {
				if (isResticError(error)) {
					return Effect.fail(error);
				}

				return Effect.fail(
					new ResticCopyCommandError({
						cause: error,
						message: toMessage(error),
					}),
				);
			}),
		),
	);
};
