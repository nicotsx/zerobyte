import type { RepositoryConfig } from "~/schemas/restic";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const repairIndex = async (
	config: RepositoryConfig,
	options: { signal?: AbortSignal; organizationId: string },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args = ["repair", "index", "--repo", repoUrl];
	addCommonArgs(args, env, config);

	const res = await safeExec({
		command: "restic",
		args,
		env,
		signal: options.signal,
	});
	await cleanupTemporaryKeys(env);

	if (options.signal?.aborted) {
		logger.warn("Restic repair index was aborted by signal.");
		return { success: false, message: "Operation aborted", output: "" };
	}

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic repair index failed: ${stderr}`);
		throw new ResticError(res.exitCode, stderr);
	}

	logger.info(`Restic repair index completed for repository: ${repoUrl}`);
	return {
		success: true,
		output: stdout,
		message: "Index repaired successfully",
	};
};
