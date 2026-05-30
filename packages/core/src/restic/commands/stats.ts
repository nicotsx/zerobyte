import { safeJsonParse } from "../../utils/json";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import { logger, safeExec } from "../../node";
import { createResticError, isResticError } from "../error";
import { resticStatsSchema } from "../restic-dto";
import type { ResticDeps } from "../types";
import { Data, Effect } from "effect";
import { toMessage } from "../../utils";

class ResticStatsCommandError extends Data.TaggedError("ResticStatsCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const stats = (config: RepositoryConfig, options: { organizationId: string }, deps: ResticDeps) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);

			const args = ["--repo", repoUrl, "stats", "--mode", "raw-data"];
			addCommonArgs(args, env, config);

			const res = await safeExec({ command: "restic", args, env });
			await cleanupTemporaryKeys(env, deps);

			if (res.exitCode !== 0) {
				logger.error(`Restic stats retrieval failed: ${res.stderr}`);
				throw createResticError(res.exitCode, res.stderr);
			}

			const parsedJson = safeJsonParse<unknown>(res.stdout);
			const result = resticStatsSchema.safeParse(parsedJson);

			if (!result.success) {
				logger.error(`Restic stats output validation failed: ${result.error.message}`);
				throw new Error(`Restic stats output validation failed: ${result.error.message}`);
			}

			return result.data;
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticStatsCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
