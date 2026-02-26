import type { RepositoryConfig } from "~/schemas/restic";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const keyAdd = async (
	config: RepositoryConfig,
	organizationId: string,
	options: { host: string; timeoutMs?: number },
) => {
	const repoUrl = buildRepoUrl(config);

	logger.info(`Adding restic key with host "${options.host}" for repository at ${repoUrl}...`);

	const env = await buildEnv(config, organizationId);

	const args = [
		"key",
		"add",
		"--repo",
		repoUrl,
		"--host",
		options.host,
		"--new-password-file",
		env.RESTIC_PASSWORD_FILE,
	];
	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env, timeout: options.timeoutMs ?? 60000 });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic key add failed: ${res.stderr}`);
		return { success: false, error: res.stderr };
	}

	logger.info(`Restic key added with host "${options.host}" for repository: ${repoUrl}`);
	return { success: true, error: null };
};
