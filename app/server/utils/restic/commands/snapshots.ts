import { type } from "arktype";
import type { RepositoryConfig } from "~/schemas/restic";
import { resticSnapshotSummarySchema } from "~/schemas/restic-dto";
import { logger } from "~/server/utils/logger";
import { safeExec } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

const snapshotInfoSchema = type({
	gid: "number?",
	hostname: "string",
	id: "string",
	parent: "string?",
	paths: "string[]",
	program_version: "string?",
	short_id: "string",
	time: "string",
	uid: "number?",
	username: "string?",
	tags: "string[]?",
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

	const result = snapshotInfoSchema.array()(JSON.parse(res.stdout));

	if (result instanceof type.errors) {
		logger.error(`Restic snapshots output validation failed: ${result.summary}`);
		throw new Error(`Restic snapshots output validation failed: ${result.summary}`);
	}

	return result;
};
