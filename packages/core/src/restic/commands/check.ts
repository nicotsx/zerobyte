import { Data, Effect } from "effect";
import { logger, safeExec } from "../../node";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";
import { ResticError } from "../error";
import { toMessage } from "../../utils";

class ResticCheckCommandError extends Data.TaggedError("ResticCheckCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const check = (
	config: RepositoryConfig,
	options: {
		readData?: boolean;
		signal?: AbortSignal;
		organizationId: string;
	},
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);

			const args: string[] = ["--repo", repoUrl, "check"];

			if (options.readData) {
				args.push("--read-data");
			}

			addCommonArgs(args, env, config);

			const res = await safeExec({
				command: "restic",
				args,
				env,
				signal: options.signal,
			});
			await cleanupTemporaryKeys(env, deps);

			if (options.signal?.aborted) {
				logger.warn("Restic check was aborted by signal.");
				return {
					success: false,
					hasErrors: true,
					output: "",
					error: "Operation aborted",
				};
			}

			const { stdout, stderr } = res;

			if (res.exitCode !== 0) {
				logger.error(`Restic check failed: ${stderr}`);
				return {
					success: false,
					hasErrors: true,
					output: stdout,
					error: stderr,
				};
			}

			const hasErrors = stdout.includes("Fatal");

			logger.info(`Restic check completed for repository: ${repoUrl}`);
			return {
				success: !hasErrors,
				hasErrors,
				output: stdout,
				error: hasErrors ? "Repository contains errors" : null,
			};
		},
		catch: (error) => {
			if (error instanceof ResticError) {
				return error;
			}

			return new ResticCheckCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
