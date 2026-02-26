import type { RepositoryConfig } from "~/schemas/restic";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const deleteSnapshots = async (config: RepositoryConfig, snapshotIds: string[], organizationId: string) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for deletion.");
	}

	const args: string[] = ["--repo", repoUrl, "forget", ...snapshotIds, "--prune"];
	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

export const deleteSnapshot = async (config: RepositoryConfig, snapshotId: string, organizationId: string) => {
	return deleteSnapshots(config, [snapshotId], organizationId);
};
