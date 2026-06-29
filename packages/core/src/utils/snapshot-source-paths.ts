import { findCommonAncestor } from "./common-ancestor.js";
import {
	findWindowsHostCommonAncestor,
	isWindowsHostPath,
	windowsHostPathToResticSnapshotPath,
	windowsResticSnapshotPathToHostPath,
} from "./path.js";

export type HostPathKind = "posix" | "windows";
export type SnapshotSourcePathKind = HostPathKind | "unsupported";

export type SnapshotSourcePathPlan = {
	sourcePathKind: SnapshotSourcePathKind;
	queryBasePath: string;
	originalRestoreBasePath: string;
	customRestoreBasePath: string;
	requiresCustomTarget: boolean;
};

const rootPlan = (
	requiresCustomTarget = false,
	sourcePathKind: SnapshotSourcePathKind = requiresCustomTarget ? "unsupported" : "posix",
): SnapshotSourcePathPlan => ({
	sourcePathKind,
	queryBasePath: "/",
	originalRestoreBasePath: "/",
	customRestoreBasePath: "/",
	requiresCustomTarget,
});

export const hostPathKindFromPath = (hostPath?: string): HostPathKind =>
	hostPath && isWindowsHostPath(hostPath) ? "windows" : "posix";

export const hostPathKindFromPlatform = (platform: string): HostPathKind =>
	platform === "win32" ? "windows" : "posix";

export const getSnapshotSourcePathPlan = ({
	snapshotPaths,
	hostPathKind = "posix",
}: {
	snapshotPaths: string[];
	hostPathKind?: HostPathKind;
}): SnapshotSourcePathPlan => {
	if (snapshotPaths.length === 0) return rootPlan();

	const hasWindowsPaths = snapshotPaths.some(isWindowsHostPath);
	const hasPosixPaths = snapshotPaths.some((path) => path.startsWith("/"));
	const hasUnsupportedNativePaths = snapshotPaths.some((path) => !path.startsWith("/") && !isWindowsHostPath(path));

	if (hasUnsupportedNativePaths || (hasWindowsPaths && hasPosixPaths)) {
		return rootPlan(true);
	}

	if (hasWindowsPaths) {
		if (hostPathKind !== "windows") {
			return rootPlan(true, "windows");
		}

		const basePath = findWindowsHostCommonAncestor(snapshotPaths);
		if (!basePath) return rootPlan(true);
		const resticBasePath = windowsHostPathToResticSnapshotPath(basePath);
		if (!resticBasePath) return rootPlan(true, "windows");

		return {
			sourcePathKind: "windows",
			queryBasePath: resticBasePath,
			originalRestoreBasePath: resticBasePath,
			customRestoreBasePath: "/",
			requiresCustomTarget: false,
		};
	}

	const basePath = findCommonAncestor(snapshotPaths);

	return {
		sourcePathKind: "posix",
		queryBasePath: basePath,
		originalRestoreBasePath: basePath,
		customRestoreBasePath: basePath,
		requiresCustomTarget: false,
	};
};

export const getOriginalRestoreTargetForRoot = ({
	restoreRoot,
	sourcePathKind,
}: {
	restoreRoot: string;
	sourcePathKind: SnapshotSourcePathKind;
}): string => {
	if (sourcePathKind !== "windows") return "/";

	const hostRestoreRoot = windowsResticSnapshotPathToHostPath(restoreRoot);
	if (!hostRestoreRoot) {
		throw new Error("Windows original restore root must use restic drive syntax.");
	}

	return hostRestoreRoot;
};
