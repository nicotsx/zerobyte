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

class ResticTagSnapshotsCommandError extends Data.TaggedError("ResticTagSnapshotsCommandError")<{
	cause: unknown;
	message: string;
}> {}

export const tagSnapshots = (
	config: RepositoryConfig,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
	options: { organizationId: string },
	deps: ResticDeps,
) => {
	return Effect.tryPromise({
		try: async () => {
			if (snapshotIds.length === 0) {
				throw new Error("No snapshot IDs provided for tagging.");
			}

			const repoUrl = buildRepoUrl(config);
			const env = await buildEnv(config, options.organizationId, deps);

			const args: string[] = ["--repo", repoUrl, "tag"];

			if (tags.add) {
				for (const tag of tags.add) {
					args.push("--add", tag);
				}
			}

			if (tags.remove) {
				for (const tag of tags.remove) {
					args.push("--remove", tag);
				}
			}

			if (tags.set) {
				for (const tag of tags.set) {
					args.push("--set", tag);
				}
			}

			addCommonArgs(args, env, config);
			args.push("--", ...snapshotIds);

			const res = await safeExec({ command: "restic", args, env });
			await cleanupTemporaryKeys(env, deps);

			if (res.exitCode !== 0) {
				logger.error(`Restic snapshot tagging failed: ${res.stderr}`);
				throw createResticError(res.exitCode, res.stderr);
			}

			return { success: true };
		},

		catch: (error) => {
			if (isResticError(error)) {
				return error;
			}

			return new ResticTagSnapshotsCommandError({
				cause: error,
				message: toMessage(error),
			});
		},
	});
};
