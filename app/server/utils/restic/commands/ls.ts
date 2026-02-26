import { type } from "arktype";
import type { RepositoryConfig } from "~/schemas/restic";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeSpawn } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

const lsNodeSchema = type({
	name: "string",
	type: "string",
	path: "string",
	uid: "number?",
	gid: "number?",
	size: "number?",
	mode: "number?",
	mtime: "string?",
	atime: "string?",
	ctime: "string?",
	struct_type: "'node'",
});

const lsSnapshotInfoSchema = type({
	time: "string",
	parent: "string?",
	tree: "string",
	paths: "string[]",
	hostname: "string",
	username: "string?",
	id: "string",
	short_id: "string",
	struct_type: "'snapshot'",
	message_type: "'snapshot'",
});

export const ls = async (
	config: RepositoryConfig,
	snapshotId: string,
	organizationId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
) => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	const args: string[] = ["--repo", repoUrl, "ls", snapshotId, "--long"];

	if (path) {
		args.push(path);
	}

	addCommonArgs(args, env, config);

	let snapshot: typeof lsSnapshotInfoSchema.infer | null = null;
	const nodes: Array<typeof lsNodeSchema.infer> = [];
	let totalNodes = 0;
	let isFirstLine = true;
	let hasMore = false;

	const offset = Math.max(options?.offset ?? 0, 0);
	const limit = Math.min(Math.max(options?.limit ?? 500, 1), 500);

	const res = await safeSpawn({
		command: "restic",
		args,
		env,
		onStdout: (line) => {
			const trimmedLine = line.trim();
			if (!trimmedLine) {
				return;
			}

			try {
				const data = JSON.parse(trimmedLine);

				if (isFirstLine) {
					isFirstLine = false;
					const snapshotValidation = lsSnapshotInfoSchema(data);
					if (!(snapshotValidation instanceof type.errors)) {
						snapshot = snapshotValidation;
					}
					return;
				}

				const nodeValidation = lsNodeSchema(data);
				if (nodeValidation instanceof type.errors) {
					logger.warn(`Skipping invalid node: ${nodeValidation.summary}`);
					return;
				}

				if (totalNodes >= offset && totalNodes < offset + limit) {
					nodes.push(nodeValidation);
				}
				totalNodes++;

				if (totalNodes >= offset + limit + 1) {
					hasMore = true;
				}
			} catch {
				// Ignore JSON parse errors for non-JSON lines
			}
		},
	});

	await cleanupTemporaryKeys(env);

	if (res.exitCode !== 0) {
		logger.error(`Restic ls failed: ${res.error}`);
		throw new ResticError(res.exitCode, res.error);
	}

	if (totalNodes > offset + limit) {
		hasMore = true;
	}

	return {
		snapshot: snapshot as typeof lsSnapshotInfoSchema.infer | null,
		nodes,
		pagination: {
			offset,
			limit,
			total: totalNodes,
			hasMore,
		},
	};
};
