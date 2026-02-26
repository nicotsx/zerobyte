import type { RepositoryConfig } from "~/schemas/restic";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { formatBandwidthLimit } from "../helpers/bandwidth";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

export const copy = async (
	sourceConfig: RepositoryConfig,
	destConfig: RepositoryConfig,
	options: { organizationId: string; tag?: string; snapshotId?: string },
) => {
	const sourceRepoUrl = buildRepoUrl(sourceConfig);
	const destRepoUrl = buildRepoUrl(destConfig);

	const sourceEnv = await buildEnv(sourceConfig, options.organizationId);
	const destEnv = await buildEnv(destConfig, options.organizationId);

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

	addCommonArgs(args, env, destConfig, { skipBandwidth: true });

	const sourceDownloadLimit = formatBandwidthLimit(sourceConfig.downloadLimit);
	const destUploadLimit = formatBandwidthLimit(destConfig.uploadLimit);

	if (sourceDownloadLimit) {
		args.push("--limit-download", sourceDownloadLimit);
	}

	if (destUploadLimit) {
		args.push("--limit-upload", destUploadLimit);
	}

	logger.info(`Copying snapshots from ${sourceRepoUrl} to ${destRepoUrl}...`);
	logger.debug(`Executing: restic ${args.join(" ")}`);

	const res = await safeExec({ command: "restic", args, env });

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
