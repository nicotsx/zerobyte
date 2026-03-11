import { z } from "zod";
import type { RepositoryConfig } from "~/schemas/restic";
import { resticSnapshotSummarySchema } from "~/schemas/restic-dto";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

const snapshotInfoSchema = z.object({
	gid: z.number().optional(),
	hostname: z.string(),
	id: z.string(),
	parent: z.string().optional(),
	paths: z.array(z.string()),
	program_version: z.string().optional(),
	short_id: z.string(),
	time: z.string(),
	uid: z.number().optional(),
	username: z.string().optional(),
	tags: z.array(z.string()).optional(),
	summary: resticSnapshotSummarySchema.optional(),
});

export const snapshots = async (config: RepositoryConfig, options: { tags?: string[]; organizationId: string }) => {
	const { tags, organizationId } = options;

	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	const args = ["--repo", repoUrl, "snapshots"];

	if (tags && tags.length > 0) {
		for (const tag of tags) {
			args.push("--tag", tag);
		}
	}

	addCommonArgs(args, env, config);

	const res = await safeExec({ command: "restic", args, env });
	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic snapshots retrieval failed: ${res.stderr}`);
		throw new Error(`Restic snapshots retrieval failed: ${res.stderr}`);
	}

	const result = snapshotInfoSchema.array().safeParse(JSON.parse(res.stdout));

	if (!result.success) {
		logger.error(`Restic snapshots output validation failed: ${result.error.message}`);
		throw new Error(`Restic snapshots output validation failed: ${result.error.message}`);
	}

	return result.data;
};
