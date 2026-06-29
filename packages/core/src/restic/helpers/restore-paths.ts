import path from "node:path";
import { findCommonAncestor } from "../../utils/common-ancestor";
import { windowsHostPathToResticSnapshotPath } from "../../utils/path";

type RestorePathInput = {
	snapshotId: string;
	target: string;
	basePath?: string;
	include?: string[];
	selectedItemKind?: "file" | "dir";
};

type RestorePathArgs = {
	restoreArg: string;
	includePatterns: string[];
};

const escapeResticIncludePattern = (pattern: string): string => pattern.replace(/[\\*?[\]]/g, "\\$&");

const toResticSnapshotPath = (snapshotPath: string): string => {
	return windowsHostPathToResticSnapshotPath(snapshotPath) ?? snapshotPath;
};

export const findResticCommonAncestor = (snapshotPaths: string[]): string => {
	const resticPaths = snapshotPaths.map(toResticSnapshotPath);
	if (resticPaths.every((snapshotPath) => snapshotPath.startsWith("/"))) {
		return findCommonAncestor(resticPaths);
	}

	if (resticPaths.some((snapshotPath) => snapshotPath.startsWith("/"))) {
		throw new Error("Snapshot paths must use a single path format.");
	}

	if (resticPaths.length === 0) return "/";
	if (resticPaths.length === 1) return resticPaths[0] || "/";

	const splitPaths = resticPaths.map((snapshotPath) => snapshotPath.split("/").filter(Boolean));
	const minLength = Math.min(...splitPaths.map((parts) => parts.length));

	const commonParts: string[] = [];
	for (let i = 0; i < minLength; i++) {
		const firstPart = splitPaths[0]?.[i];
		if (!firstPart) break;

		if (splitPaths.every((parts) => parts[i]?.toLowerCase() === firstPart.toLowerCase())) {
			commonParts.push(firstPart);
		} else {
			break;
		}
	}

	if (!commonParts.length) {
		throw new Error("Snapshot paths must be on the same drive.");
	}

	return commonParts.join("/");
};

export const getResticRestoreRoot = (includes: string[], selectedItemKind?: "file" | "dir"): string => {
	if (selectedItemKind === "file" && includes.length === 1) {
		return path.posix.dirname(toResticSnapshotPath(includes[0] ?? "/"));
	}

	return findResticCommonAncestor(includes);
};

const getIncludePatterns = (include: string[] | undefined, target: string, restoreRoot: string): string[] => {
	if (!include?.length) return [];

	if (target === "/") {
		return include.map((pattern) => escapeResticIncludePattern(toResticSnapshotPath(pattern)));
	}

	const strippedIncludes = include.map((pattern) => path.posix.relative(restoreRoot, toResticSnapshotPath(pattern)));
	const includesCoverRestoreRoot = strippedIncludes.some((pattern) => pattern === "" || pattern === ".");

	if (includesCoverRestoreRoot) {
		return [];
	}

	return strippedIncludes.map(escapeResticIncludePattern);
};

export const createRestorePathArgs = ({
	snapshotId,
	target,
	basePath,
	include,
	selectedItemKind,
}: RestorePathInput): RestorePathArgs => {
	const includes = include?.length ? include : [basePath ?? "/"];
	const restoreRoot = getResticRestoreRoot(includes, selectedItemKind);
	const restoreArg = target === "/" ? snapshotId : `${snapshotId}:${restoreRoot}`;

	return {
		restoreArg,
		includePatterns: getIncludePatterns(include, target, restoreRoot),
	};
};
