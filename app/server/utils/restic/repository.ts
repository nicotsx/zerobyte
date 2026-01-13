import type { RepositoryConfig } from "~/schemas/restic";
import type { RetentionPolicy } from "../../modules/backups/backups.dto";
import { ResticError } from "../errors";
import { logger } from "../logger";
import { safeSpawn } from "../spawn";
import { buildEnv, buildRepoUrl } from "./config";
import { addCommonArgs, cleanupTemporaryKeys } from "./utils";

export const forget = async (config: RepositoryConfig, options: RetentionPolicy, extra: { tag: string }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "forget", "--group-by", "tags", "--tag", extra.tag];

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

	args.push("--prune");
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic forget failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

export const deleteSnapshots = async (config: RepositoryConfig, snapshotIds: string[]) => {
	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for deletion.");
	}

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "forget", ...snapshotIds, "--prune"];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot deletion failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

export const deleteSnapshot = async (config: RepositoryConfig, snapshotId: string) => {
	return deleteSnapshots(config, [snapshotId]);
};

export const tagSnapshots = async (
	config: RepositoryConfig,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
) => {
	if (snapshotIds.length === 0) {
		throw new Error("No snapshot IDs provided for tagging.");
	}

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "tag", ...snapshotIds];

	const addTags = (tagList: string[] | undefined, flag: string) => {
		if (tagList) {
			for (const tag of tagList) {
				args.push(flag, tag);
			}
		}
	};

	addTags(tags.add, "--add");
	addTags(tags.remove, "--remove");
	addTags(tags.set, "--set");

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshot tagging failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	return { success: true };
};

export const unlock = async (config: RepositoryConfig) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args = ["unlock", "--repo", repoUrl, "--remove-all"];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic unlock failed: ${res.stderr}`);
		throw new ResticError(res.exitCode, res.stderr);
	}

	logger.info(`Restic unlock succeeded for repository: ${repoUrl}`);
	return { success: true, message: "Repository unlocked successfully" };
};

export const check = async (config: RepositoryConfig, options?: { readData?: boolean }) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args: string[] = ["--repo", repoUrl, "check"];

	if (options?.readData) {
		args.push("--read-data");
	}

	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic check failed: ${stderr}`);
		return {
			success: false,
			hasErrors: true,
			output: stdout,
			error: stderr,
		};
	}

	const hasErrors = stdout.includes("Fatal");

	logger.info(`Restic check completed for repository: ${repoUrl}`);
	return {
		success: !hasErrors,
		hasErrors,
		output: stdout,
		error: hasErrors ? "Repository contains errors" : null,
	};
};

export const repairIndex = async (config: RepositoryConfig) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config);

	const args = ["repair", "index", "--repo", repoUrl];
	addCommonArgs(args, env);

	const res = await safeSpawn({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

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

export const copy = async (
	sourceConfig: RepositoryConfig,
	destConfig: RepositoryConfig,
	options: {
		tag?: string;
		snapshotId?: string;
	},
) => {
	const sourceRepoUrl = buildRepoUrl(sourceConfig);
	const destRepoUrl = buildRepoUrl(destConfig);

	const sourceEnv = await buildEnv(sourceConfig);
	const destEnv = await buildEnv(destConfig);

	const env: Record<string, string> = {
		...sourceEnv,
		...destEnv,
		RESTIC_FROM_PASSWORD_FILE: sourceEnv.RESTIC_PASSWORD_FILE,
	};

	const args: string[] = ["--repo", destRepoUrl, "copy", "--from-repo", sourceRepoUrl];

	if (options.tag) {
		args.push("--tag", options.tag);
	}

	if (options.snapshotId) {
		args.push(options.snapshotId);
	} else {
		args.push("latest");
	}

	addCommonArgs(args, env);

	if (sourceConfig.backend === "sftp" && sourceEnv._SFTP_SSH_ARGS) {
		args.push("-o", `sftp.args=${sourceEnv._SFTP_SSH_ARGS}`);
	}

	logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
	logger.debug(`Executing: restic ${args.join(" ")}`);

	const res = await safeSpawn({ command: "restic", args, env });

	await cleanupTemporaryKeys(sourceEnv);
	await cleanupTemporaryKeys(destEnv);

	const { stdout, stderr } = res;

	if (res.exitCode !== 0) {
		logger.error(`Restic copy failed: ${stderr}`);
		throw new ResticError(res.exitCode, stderr);
	}

	logger.info(`Restic copy completed from ${sourceRepoUrl} to ${destRepoUrl}`);
	return {
		success: true,
		output: stdout,
	};
};
