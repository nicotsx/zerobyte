import { type } from "arktype";
import type { RepositoryConfig } from "~/schemas/restic";
import { resticStatsSchema } from "~/schemas/restic-dto";
import { safeJsonParse } from "~/server/utils/json";
import { logger } from "~/server/utils/logger";
import { ResticError } from "~/server/utils/errors";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const stats = async (config: RepositoryConfig, options: { organizationId: string }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, options.organizationId);

	const args = ["--repo", repoUrl, "stats", "--mode", "raw-data"];
	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic stats retrieval failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	const parsedJson = safeJsonParse<unknown>(res.stdout);
	const result = resticStatsSchema(parsedJson);

	if (result instanceof type.errors) {
		logger.error(`Restic stats output validation failed: ${result.summary}`);
		throw new Error(`Restic stats output validation failed: ${result.summary}`);
	}

	return result;
};
