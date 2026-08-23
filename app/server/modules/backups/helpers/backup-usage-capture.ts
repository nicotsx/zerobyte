import { logger } from "@zerobyte/core/node";
import { createUsageFold } from "@zerobyte/core/usage";
import { walkSource } from "@zerobyte/core/usage/node";
import { toMessage } from "../../../utils/errors";
import { getVolumePath } from "../../volumes/helpers";
import { LOCAL_AGENT_ID } from "../../agents/constants";
import { pruneUsageTrees, saveUsageTree } from "../../repositories/helpers/snapshot-usage-store";
import type { BackupContext } from "./backup-lifecycle";

/**
 * Builds the snapshot's disk usage tree by walking the mounted source.
 *
 * Deliberately reads the source rather than the repository: restic has just
 * walked the same tree so the inode cache is warm, and it costs nothing at the
 * backend — which matters where reads are billed per request or per byte.
 *
 * Two consequences of reading the source, both intentional:
 *
 * - The totals include paths the schedule excludes, so they will not match the
 *   snapshot's `total_bytes_processed`. The gap is what the excludes are saving,
 *   and the UI shows it as such.
 * - It only works where the volume is mounted. Backups executed on a remote
 *   agent are skipped here; capturing those needs the agent to walk its own
 *   source and ship the tree back.
 *
 * Never throws. A missing usage tree is a cosmetic loss; a backup that fails
 * because of one is not.
 */
export const captureSnapshotUsage = async (params: {
	ctx: BackupContext;
	snapshotId: string | null | undefined;
	signal?: AbortSignal;
}): Promise<void> => {
	const { ctx, snapshotId, signal } = params;
	const { schedule, volume, repository, organizationId } = ctx;

	if (!snapshotId) return;

	// restic's backup summary reports the full 64-char id, but every other read
	// path in the app (routes, frontend, deletion) keys snapshots by the 8-char
	// short id restic derives from it. Store under the same short id so lookups
	// actually find this row.
	const shortSnapshotId = snapshotId.slice(0, 8);

	if (volume.agentId !== LOCAL_AGENT_ID) {
		logger.debug(
			`Skipping storage usage capture for schedule ${schedule.shortId}: volume ${volume.shortId} lives on agent ${volume.agentId}`,
		);
		return;
	}

	const sourcePath = getVolumePath(volume);
	const startedAt = Date.now();

	try {
		const fold = createUsageFold({ roots: [sourcePath] });

		await walkSource({
			root: sourcePath,
			fold,
			signal,
			oneFileSystem: schedule.oneFileSystem,
		});

		const tree = fold.finish();
		const durationMs = Date.now() - startedAt;

		saveUsageTree({
			repositoryId: repository.id,
			organizationId,
			snapshotId: shortSnapshotId,
			scheduleShortId: schedule.shortId,
			source: "backup",
			durationMs,
			tree,
		});

		pruneUsageTrees({ organizationId, scheduleShortId: schedule.shortId });

		logger.debug(
			`Captured storage usage for snapshot ${shortSnapshotId}: ${tree.totals.fileCount} files, ${tree.totals.size} bytes in ${durationMs}ms`,
		);
	} catch (error) {
		logger.warn(`Failed to capture storage usage for snapshot ${shortSnapshotId}: ${toMessage(error)}`);
	}
};
