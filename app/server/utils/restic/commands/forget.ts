import type { RepositoryConfig } from "~/schemas/restic";
import type { RetentionPolicy } from "~/server/modules/backups/backups.dto";
import { ResticError } from "~/server/utils/errors";
import { safeJsonParse } from "~/server/utils/json";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import type { ResticForgetResponse } from "../types";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const forget = async (
	config: RepositoryConfig,
	options: RetentionPolicy,
	extra: { tag: string; organizationId: string; dryRun?: boolean },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, extra.organizationId);

	const args: string[] = ["--repo", repoUrl, "forget", "--group-by", "tags", "--tag", extra.tag];

	if (extra.dryRun) {
		args.push("--dry-run", "--no-lock");
	}

	if (options.keepLast) {
		args.push("--keep-last", String(options.keepLast));
	}
	if (options.keepHourly) {
		args.push("--keep-hourly", String(options.keepHourly));
	}
	if (options.keepDaily) {
		args.push("--keep-daily", String(options.keepDaily));
	}
	if (options.keepWeekly) {
		args.push("--keep-weekly", String(options.keepWeekly));
	}
	if (options.keepMonthly) {
		args.push("--keep-monthly", String(options.keepMonthly));
	}
	if (options.keepYearly) {
		args.push("--keep-yearly", String(options.keepYearly));
	}
	if (options.keepWithinDuration) {
		args.push("--keep-within-duration", options.keepWithinDuration);
	}

	if (!extra.dryRun) {
		args.push("--prune");
	}

	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic forget failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	const lines = res.stdout.split("\n").filter((line) => line.trim());
	const result = extra.dryRun ? safeJsonParse<ResticForgetResponse>(lines.at(-1) ?? "[]") : null;

	return { success: true, data: result };
};
