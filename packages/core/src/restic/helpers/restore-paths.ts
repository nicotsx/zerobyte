import {
	getRelativeResticPath,
	getResticRestoreRoot,
	toResticSnapshotPath,
	type SnapshotSourcePathKind,
} from "./snapshot-paths";

export { findResticCommonAncestor, getResticRestoreRoot } from "./snapshot-paths";

type RestorePathInput = {
	snapshotId: string;
	target: string;
	basePath?: string;
	sourcePathKind?: SnapshotSourcePathKind;
	include?: string[];
	exclude?: string[];
	selectedItemKind?: "file" | "dir";
};

type RestorePathArgs = {
	restoreArg: string;
	includePatterns: string[];
	excludePatterns: string[];
};

const escapeResticIncludePattern = (pattern: string): string => pattern.replace(/[\\*?[\]]/g, "\\$&");

const getPathPatterns = (
	patterns: string[],
	target: string,
	restoreRoot: string,
	sourcePathKind?: SnapshotSourcePathKind,
): string[] => {
	if (target === "/") {
		return patterns.map(toResticSnapshotPath);
	}

	return patterns.map((pattern) => getRelativeResticPath(restoreRoot, pattern, sourcePathKind));
};

const getIncludePatterns = (
	includes: string[],
	target: string,
	restoreRoot: string,
	sourcePathKind?: SnapshotSourcePathKind,
): string[] => {
	if (!includes.length) return [];

	const includePatterns = getPathPatterns(includes, target, restoreRoot, sourcePathKind);
	const includesCoverRestoreRoot =
		target !== "/" && includePatterns.some((pattern) => pattern === "" || pattern === ".");

	if (includesCoverRestoreRoot) {
		return [];
	}

	return includePatterns.map(escapeResticIncludePattern);
};

export const createRestorePathArgs = ({
	snapshotId,
	target,
	basePath,
	sourcePathKind,
	include,
	exclude,
	selectedItemKind,
}: RestorePathInput): RestorePathArgs => {
	const includes = include?.length ? include : [basePath ?? "/"];
	const restoreRoot = getResticRestoreRoot(includes, selectedItemKind, sourcePathKind);
	const restoreArg = target === "/" ? snapshotId : `${snapshotId}:${restoreRoot}`;

	return {
		restoreArg,
		includePatterns: getIncludePatterns(includes, target, restoreRoot, sourcePathKind),
		excludePatterns: exclude ?? [],
	};
};
