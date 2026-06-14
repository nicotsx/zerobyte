import { Data, Effect } from "effect";
import { logger, safeExec } from "../../node";
import { createResticError, isResticError } from "../error";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";
import { toMessage } from "../../utils";

class ResticUnlockCommandError extends Data.TaggedError("ResticUnlockCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const unlock = (
	config: RepositoryConfig,
	options: { signal?: AbortSignal; organizationId: string; removeAll?: boolean },
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);

			const args = ["unlock", "--repo", repoUrl];
			if (options.removeAll) {
				args.push("--remove-all");
			}
			addCommonArgs(args, env, config);

			const res = await safeExec({
				command: deps.resticCommand ?? "restic",
				args,
				env,
				signal: options.signal,
			});
			await cleanupTemporaryKeys(env, deps);

			if (options.signal?.aborted) {
				logger.warn("Restic unlock was aborted by signal.");
				return { success: false, message: "Operation aborted" };
			}

			if (res.exitCode !== 0) {
				logger.error(`Restic unlock failed: ${res.stderr}`);
				throw createResticError(res.exitCode, res.stderr);
			}

			logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
			return { success: true, message: "Repository unlocked successfully" };
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticUnlockCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
