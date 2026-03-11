import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";
import { keyAdd } from "./key-add";
import type { RepositoryConfig } from "../schemas";
import { logger, safeExec } from "../../node";
import type { ResticDeps } from "../types";

const addDefaultKey = async (
	config: RepositoryConfig,
	organizationId: string,
	options: { timeoutMs?: number },
	deps: ResticDeps,
) => {
	if (deps?.hostname) {
		const keyResult = await keyAdd(
			config,
			organizationId,
			{
				host: deps.hostname,
				timeoutMs: options?.timeoutMs,
			},
			deps,
		);

		if (!keyResult.success) {
			logger.warn(`Repository initialized but failed to add key with hostname: ${keyResult.error}`);
		}
	}
};

export const init = async (
	config: RepositoryConfig,
	organizationId: string,
	options: { timeoutMs?: number } | undefined,
	deps: ResticDeps,
) => {
	const repoUrl = buildRepoUrl(config);

	logger.info(`Initializing restic repository at ${repoUrl}...`);

	const env = await buildEnv(config, organizationId, deps);

	const args = ["init", "--repo", repoUrl];
	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env, timeout: options?.timeoutMs ?? 60000 });
	await cleanupTemporaryKeys(env, deps);

	if (res.exitCode !== 0) {
		logger.error(`Restic init failed: ${res.stderr}`);
		return { success: false, error: res.stderr };
	}

	logger.info(`Restic repository initialized: ${repoUrl}`);

	void addDefaultKey(
		config,
		organizationId,
		{
			timeoutMs: options?.timeoutMs,
		},
		deps,
	);

	return { success: true, error: null };
};
