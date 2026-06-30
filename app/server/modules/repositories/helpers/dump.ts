import { BadRequestError } from "http-errors-enhanced";
import { createSnapshotPathContext, SnapshotDumpPlanningError } from "@zerobyte/core/restic";

const sanitizeFilenamePart = (value: string): string => {
	const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
	return sanitized || "snapshot";
};

export const prepareSnapshotDump = (params: {
	snapshotId: string;
	snapshotPaths: string[];
	requestedPath?: string;
}) => {
	const { snapshotId, snapshotPaths, requestedPath } = params;

	const archiveFilename = `snapshot-${sanitizeFilenamePart(snapshotId)}.tar`;

	try {
		const dumpPlan = createSnapshotPathContext({ snapshotPaths }).dump.plan({ snapshotId, requestedPath });

		return {
			...dumpPlan,
			filename: archiveFilename,
		};
	} catch (error) {
		if (error instanceof SnapshotDumpPlanningError) {
			throw new BadRequestError("Requested path is outside the snapshot base path");
		}

		throw error;
	}
};
