import { Data, Effect } from "effect";
import { logger, safeExec } from "../../node";
import { ResticError } from "../error";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";
import { toMessage } from "../../utils";

class ResticDeleteSnapshotCommandError extends Data.TaggedError("ResticDeleteSnapshotCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const deleteSnapshots = (
	config: RepositoryConfig,
	snapshotIds: string[],
	options: { organizationId: string },
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			if (snapshotIds.length === 0) {
				throw new Error("No snapshot IDs provided for deletion.");
			}

			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);

			const args: string[] = ["--repo", repoUrl, "forget", "--prune"];
			addCommonArgs(args, env, config);
			args.push("--", ...snapshotIds);

			const res = await safeExec({ command: "restic", args, env });
			await cleanupTemporaryKeys(env, deps);

			if (res.exitCode !== 0) {
				logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
				throw new ResticError(res.exitCode, res.stderr);
			}

			return { success: true };
		},
		catch: (error) => {
			if (error instanceof ResticError) {
				return error;
			}

			return new ResticDeleteSnapshotCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};

export const deleteSnapshot = (
	config: RepositoryConfig,
	snapshotId: string,
	options: { organizationId: string },
	deps: ResticDeps,
) => {
	return deleteSnapshots(config, [snapshotId], options, deps);
};
