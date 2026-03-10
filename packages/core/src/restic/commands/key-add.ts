import { logger, safeExec } from "../../utils";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import type { RepositoryConfig } from "../schemas";
import type { ResticDeps } from "../types";

export const keyAdd = async (
	config: RepositoryConfig,
	organizationId: string,
	options: { host: string; timeoutMs?: number },
	deps: ResticDeps,
) => {
	const repoUrl = buildRepoUrl(config);

	logger.info(`Adding restic key with host "${options.host}" for repository at ${repoUrl}...`);

	const env = await buildEnv(config, organizationId, deps);

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
};
