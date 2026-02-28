import { z } from "zod";
import type { RepositoryConfig } from "~/schemas/restic";
import { ResticError } from "~/server/utils/errors";
import { logger } from "~/server/utils/logger";
import { safeSpawn } from "~/server/utils/spawn";
import { addCommonArgs } from "../helpers/add-common-args";
import { buildEnv } from "../helpers/build-env";
import { buildRepoUrl } from "../helpers/build-repo-url";
import { cleanupTemporaryKeys } from "../helpers/cleanup-temporary-keys";

const lsNodeSchema = z.object({
	name: z.string(),
	type: z.string(),
	path: z.string(),
	uid: z.number().optional(),
	gid: z.number().optional(),
	size: z.number().optional(),
	mode: z.number().optional(),
	mtime: z.string().optional(),
	atime: z.string().optional(),
	ctime: z.string().optional(),
	struct_type: z.literal("node"),
});

const lsSnapshotInfoSchema = z.object({
	time: z.string(),
	parent: z.string().optional(),
	tree: z.string(),
	paths: z.array(z.string()),
	hostname: z.string(),
	username: z.string().optional(),
	id: z.string(),
	short_id: z.string(),
	struct_type: z.literal("snapshot"),
	message_type: z.literal("snapshot"),
});

type LsNode = z.infer<typeof lsNodeSchema>;
type LsSnapshotInfo = z.infer<typeof lsSnapshotInfoSchema>;

export type ResticLsResult = {
	snapshot: LsSnapshotInfo | null;
	nodes: LsNode[];
	pagination: {
		offset: number;
		limit: number;
		total: number;
		hasMore: boolean;
	};
};

export const ls = async (
	config: RepositoryConfig,
	snapshotId: string,
	organizationId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
): Promise<ResticLsResult> => {
	const repoUrl = buildRepoUrl(config);
	const env = await buildEnv(config, organizationId);

	const args: string[] = ["--repo", repoUrl, "ls", snapshotId, "--long"];

	if (path) {
		args.push(path);
	}

	addCommonArgs(args, env, config);

	let snapshot: LsSnapshotInfo | null = null;
	const nodes: LsNode[] = [];
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
					const snapshotValidation = lsSnapshotInfoSchema.safeParse(data);
					if (snapshotValidation.success) {
						snapshot = snapshotValidation.data;
					}
					return;
				}

				const nodeValidation = lsNodeSchema.safeParse(data);
				if (!nodeValidation.success) {
					logger.warn(`Skipping invalid node: ${nodeValidation.error.message}`);
					return;
				}

				if (totalNodes >= offset && totalNodes < offset + limit) {
					nodes.push(nodeValidation.data);
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
		snapshot,
		nodes,
		pagination: {
			offset,
			limit,
			total: totalNodes,
			hasMore,
		},
	};
};
