import { logger, safeExec } from "../../node";
import { ResticError } from "../error";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";

export const tagSnapshots = async (
	config: RepositoryConfig,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
	organizationId: string,
	deps: ResticDeps,
) => {
	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for tagging.");
	}

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId, deps);

	const args: string[] = ["--repo", repoUrl, "tag", ...snapshotIds];

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

	const res = await safeExec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env, deps);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot tagging failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};
