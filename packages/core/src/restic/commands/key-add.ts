import { Data, Effect } from "effect";
import { logger, safeExec } from "../../node";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";
import { toMessage } from "../../utils";
import { isResticError } from "../error";

class ResticKeyAddCommandError extends Data.TaggedError("ResticKeyAddCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const keyAdd = (
	config: RepositoryConfig,
	options: { organizationId: string; host: string; timeoutMs?: number },
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);

			logger.info(`Adding restic key with host "${options.host}" for repository at ${repoUrl}...`);

			const env = await buildEnv(config, options.organizationId, deps);

			const args = [
				"key",
				"add",
				"--repo",
				repoUrl,
				"--host",
				options.host,
				"--new-password-file",
				env.RESTIC_PASSWORD_FILE,
			].filter((e) => e !== undefined);

			addCommonArgs(args, env, config);

			const res = await safeExec({ command: "restic", args, env, timeout: options.timeoutMs ?? 60000 });
			await cleanupTemporaryKeys(env, deps);

			if (res.exitCode !== 0) {
				logger.error(`Restic key add failed: ${res.stderr}`);
				return { success: false, error: res.stderr };
			}

			logger.info(`Restic key added with host "${options.host}" for repository: ${repoUrl}`);
			return { success: true, error: null };
		},
		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticKeyAddCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
