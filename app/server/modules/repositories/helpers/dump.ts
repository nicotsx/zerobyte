import { BadRequestError } from "http-errors-enhanced";
import path from "node:path";
import { findCommonAncestor, normalizeAbsolutePath } from "@zerobyte/core/utils";

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
	const normalizedRequestedPath = normalizeAbsolutePath(requestedPath);
	const hasNonPosixSnapshotPaths = snapshotPaths.some((snapshotPath) => !snapshotPath.startsWith("/"));
	const basePath = hasNonPosixSnapshotPaths ? "/" : findCommonAncestor(snapshotPaths);

	if (basePath === "/") {
		return {
			snapshotRef: snapshotId,
			path: normalizedRequestedPath,
			filename: archiveFilename,
		};
	}

	if (normalizedRequestedPath === "/" || normalizedRequestedPath === basePath) {
		return {
			snapshotRef: `${snapshotId}:${basePath}`,
			path: "/",
			filename: archiveFilename,
		};
	}

	const relativeFromRequested = path.posix.relative(normalizedRequestedPath, basePath);
	if (relativeFromRequested !== ".." && !relativeFromRequested.startsWith("../")) {
		return {
			snapshotRef: `${snapshotId}:${normalizedRequestedPath}`,
			path: "/",
			filename: archiveFilename,
		};
	}

	const relativeFromBase = path.posix.relative(basePath, normalizedRequestedPath);
	if (relativeFromBase === ".." || relativeFromBase.startsWith("../")) {
		throw new BadRequestError("Requested path is outside the snapshot base path");
	}

	const relativePath = relativeFromBase ? `/${relativeFromBase}` : "/";

	return {
		snapshotRef: `${snapshotId}:${basePath}`,
		path: relativePath,
		filename: archiveFilename,
	};
};
