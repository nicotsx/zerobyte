import { logger, safeExec } from "../../node";
import { ResticError } from "../error";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";

export const unlock = async (
	config: RepositoryConfig,
	options: { signal?: AbortSignal; organizationId: string },
	deps: ResticDeps,
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId, deps);

	const args = ["unlock", "--repo", repoUrl, "--remove-all"];
	addCommonArgs(args, env, config);

	const res = await safeExec({
		command: "restic",
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
		throw new ResticError(res.exitCode, res.stderr);
	}

	logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
	return { success: true, message: "Repository unlocked successfully" };
};
