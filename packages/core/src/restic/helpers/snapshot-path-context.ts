import { isWindowsHostPath, windowsResticSnapshotPathToHostPath } from "../../utils/path";
import type { OverwriteMode } from "../schemas";
import {
	findResticCommonAncestor,
	findWindowsResticCommonAncestor,
	getPosixRelativePath,
	getResticRestoreRoot,
	isUnsupportedNativeSnapshotPath,
	isWindowsResticSnapshotPath,
	toResticSnapshotPath,
	type HostPathKind,
	type SnapshotSourcePathKind,
} from "./snapshot-paths";

export type { HostPathKind, SnapshotSourcePathKind } from "./snapshot-paths";

export type SnapshotPathContextInput = {
	snapshotPaths: string[];
	targetPlatform?: string;
	displayBasePath?: string;
};

export type SnapshotSourcePathPlan = {
	sourcePathKind: SnapshotSourcePathKind;
	queryBasePath: string;
	originalRestoreBasePath: string;
	customRestoreBasePath: string;
	requiresCustomTarget: boolean;
};

export type SnapshotPathContextSource = SnapshotSourcePathPlan & {
	canRestoreOriginal: boolean;
};

export type SnapshotRestoreLocation = { kind: "original" } | { kind: "custom"; targetPath: string };

export type SnapshotRestoreRequest = {
	location: SnapshotRestoreLocation;
	include?: string[];
	selectedItemKind?: "file" | "dir";
	exclude?: string[];
	excludeXattr?: string[];
	delete?: boolean;
	overwrite?: OverwriteMode;
};

export type SnapshotRestoreExecutionPlan = {
	target: string;
	options: {
		basePath: string;
		sourcePathKind: SnapshotSourcePathKind;
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		overwrite?: OverwriteMode;
	};
	sourcePathPlan: SnapshotSourcePathPlan;
};

export type SnapshotRestoreTargetPlan = Pick<SnapshotSourcePathPlan, "queryBasePath" | "requiresCustomTarget">;

export type SnapshotDumpPlan = {
	snapshotRef: string;
	path: string;
};

export type SnapshotDumpPlanRequest = {
	snapshotId: string;
	requestedPath?: string;
	kind?: "file" | "dir";
};

export type SnapshotPathContext = {
	source: SnapshotPathContextSource;
	browser: {
		initialQueryPath(): string;
		toDisplayPath(snapshotPath: string): string;
		toSnapshotPath(displayPath: string): string;
		isDisplayBaseCompatible(): boolean;
	};
	restore: {
		plan(request: SnapshotRestoreRequest): SnapshotRestoreExecutionPlan;
		targetPlan(): SnapshotRestoreTargetPlan;
	};
	dump: {
		plan(request: SnapshotDumpPlanRequest): SnapshotDumpPlan;
	};
};

export class SnapshotRestorePlanningError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SnapshotRestorePlanningError";
	}
}

export class SnapshotDumpPlanningError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SnapshotDumpPlanningError";
	}
}

const rootSourcePlan = (
	requiresCustomTarget = false,
	sourcePathKind: SnapshotSourcePathKind = requiresCustomTarget ? "unsupported" : "posix",
): SnapshotPathContextSource => ({
	sourcePathKind,
	queryBasePath: "/",
	originalRestoreBasePath: "/",
	customRestoreBasePath: "/",
	requiresCustomTarget,
	canRestoreOriginal: !requiresCustomTarget,
});

const hostPathKindFromPlatform = (platform?: string): HostPathKind | undefined => {
	if (!platform) return undefined;
	return platform === "win32" ? "windows" : "posix";
};

const pathKindFromDisplayBasePath = (displayBasePath?: string): HostPathKind | undefined =>
	displayBasePath && isWindowsHostPath(displayBasePath) ? "windows" : undefined;

const getTargetPathKind = (input: SnapshotPathContextInput): HostPathKind =>
	hostPathKindFromPlatform(input.targetPlatform) ?? pathKindFromDisplayBasePath(input.displayBasePath) ?? "posix";

const isWindowsSourcePath = (snapshotPath: string, targetPathKind: HostPathKind): boolean =>
	isWindowsHostPath(snapshotPath) || (targetPathKind === "windows" && isWindowsResticSnapshotPath(snapshotPath));

const isPosixSourcePath = (snapshotPath: string, targetPathKind: HostPathKind): boolean =>
	snapshotPath.startsWith("/") && !(targetPathKind === "windows" && isWindowsResticSnapshotPath(snapshotPath));

const createSourcePlan = (snapshotPaths: string[], targetPathKind: HostPathKind): SnapshotPathContextSource => {
	if (snapshotPaths.length === 0) return rootSourcePlan();

	const hasWindowsPaths = snapshotPaths.some((snapshotPath) => isWindowsSourcePath(snapshotPath, targetPathKind));
	const hasPosixPaths = snapshotPaths.some((snapshotPath) => isPosixSourcePath(snapshotPath, targetPathKind));
	const hasUnsupportedNativePaths = snapshotPaths.some(isUnsupportedNativeSnapshotPath);

	if (hasUnsupportedNativePaths || (hasWindowsPaths && hasPosixPaths)) {
		return rootSourcePlan(true);
	}

	if (hasWindowsPaths) {
		const basePath = findWindowsResticCommonAncestor(snapshotPaths);
		if (!basePath) return rootSourcePlan(true, "windows");

		return {
			sourcePathKind: "windows",
			queryBasePath: basePath,
			originalRestoreBasePath: basePath,
			customRestoreBasePath: "/",
			requiresCustomTarget: targetPathKind !== "windows",
			canRestoreOriginal: targetPathKind === "windows",
		};
	}

	const basePath = findResticCommonAncestor(snapshotPaths, "posix");

	return {
		sourcePathKind: "posix",
		queryBasePath: basePath,
		originalRestoreBasePath: basePath,
		customRestoreBasePath: basePath,
		requiresCustomTarget: false,
		canRestoreOriginal: true,
	};
};

const isPathWithinLiteral = (base: string, target: string): boolean =>
	base === "/" || target === base || target.startsWith(`${base}/`);

const isPathWithinCaseInsensitive = (base: string, target: string): boolean =>
	isPathWithinLiteral(base.toLowerCase(), target.toLowerCase());

const isWindowsComparison = (sourcePathKind: SnapshotSourcePathKind): boolean => sourcePathKind === "windows";

const isSnapshotPathWithin = (base: string, target: string, sourcePathKind: SnapshotSourcePathKind): boolean => {
	if (isPathWithinLiteral(base, target)) return true;
	return isWindowsComparison(sourcePathKind) && isPathWithinCaseInsensitive(base, target);
};

const isSameSnapshotPath = (left: string, right: string, sourcePathKind: SnapshotSourcePathKind): boolean => {
	if (left === right) return true;
	return isWindowsComparison(sourcePathKind) && left.toLowerCase() === right.toLowerCase();
};

const getCasedPathPrefix = (basePath: string, targetPath: string): string => {
	if (basePath === "/") return "/";
	return targetPath.slice(0, basePath.length);
};

const getRelativeSnapshotPath = (
	basePath: string,
	targetPath: string,
	sourcePathKind: SnapshotSourcePathKind,
): string | undefined => {
	if (isSameSnapshotPath(basePath, targetPath, sourcePathKind)) return "";
	if (!isSnapshotPathWithin(basePath, targetPath, sourcePathKind)) return undefined;

	if (isWindowsComparison(sourcePathKind)) {
		return targetPath.slice(basePath.length).replace(/^\/+/, "");
	}

	return getPosixRelativePath(basePath, targetPath);
};

const getOriginalRestoreTargetForRoot = ({
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

export const createSnapshotPathContext = (input: SnapshotPathContextInput): SnapshotPathContext => {
	const targetPathKind = getTargetPathKind(input);
	const source = createSourcePlan(input.snapshotPaths, targetPathKind);
	const normalizedDisplayBasePath = toResticSnapshotPath(input.displayBasePath ?? "/");

	const isDisplayBaseCompatible = () => {
		if (!input.displayBasePath) return true;
		return isSnapshotPathWithin(normalizedDisplayBasePath, source.queryBasePath, source.sourcePathKind);
	};

	const getEffectiveDisplayBasePath = () => {
		if (isPathWithinLiteral(normalizedDisplayBasePath, source.queryBasePath)) {
			return normalizedDisplayBasePath;
		}

		if (
			isWindowsComparison(source.sourcePathKind) &&
			isPathWithinCaseInsensitive(normalizedDisplayBasePath, source.queryBasePath)
		) {
			return getCasedPathPrefix(normalizedDisplayBasePath, source.queryBasePath);
		}

		return "/";
	};

	const restoreTargetPlan = (): SnapshotRestoreTargetPlan => ({
		queryBasePath: source.queryBasePath,
		requiresCustomTarget: source.requiresCustomTarget || !isDisplayBaseCompatible(),
	});

	const restorePlan = (request: SnapshotRestoreRequest): SnapshotRestoreExecutionPlan => {
		const location = request.location;
		const isCustomLocation = location.kind === "custom";

		if (location.kind === "custom" && location.targetPath.length === 0) {
			throw new SnapshotRestorePlanningError("Restore target path is required for custom-location restores.");
		}

		if (!isCustomLocation && restoreTargetPlan().requiresCustomTarget) {
			throw new SnapshotRestorePlanningError(
				"Original location restore is unavailable for this snapshot. Restore it to a custom location instead.",
			);
		}

		const basePath = isCustomLocation ? source.customRestoreBasePath : source.originalRestoreBasePath;
		const restoreIncludes = request.include?.length ? request.include.map(toResticSnapshotPath) : [basePath];
		const restoreRoot = getResticRestoreRoot(restoreIncludes, request.selectedItemKind, source.sourcePathKind);
		const target =
			location.kind === "custom"
				? location.targetPath
				: getOriginalRestoreTargetForRoot({ restoreRoot, sourcePathKind: source.sourcePathKind });

		return {
			target,
			options: {
				basePath,
				sourcePathKind: source.sourcePathKind,
				...(request.include ? { include: restoreIncludes } : {}),
				...(request.selectedItemKind ? { selectedItemKind: request.selectedItemKind } : {}),
				...(request.exclude ? { exclude: request.exclude } : {}),
				...(request.excludeXattr ? { excludeXattr: request.excludeXattr } : {}),
				...(request.delete !== undefined ? { delete: request.delete } : {}),
				...(request.overwrite ? { overwrite: request.overwrite } : {}),
			},
			sourcePathPlan: {
				sourcePathKind: source.sourcePathKind,
				queryBasePath: source.queryBasePath,
				originalRestoreBasePath: source.originalRestoreBasePath,
				customRestoreBasePath: source.customRestoreBasePath,
				requiresCustomTarget: source.requiresCustomTarget,
			},
		};
	};

	const dumpPlan = ({ snapshotId, requestedPath }: SnapshotDumpPlanRequest): SnapshotDumpPlan => {
		const normalizedRequestedPath = toResticSnapshotPath(requestedPath ?? "/");
		const basePath = source.queryBasePath;

		if (basePath === "/") {
			return {
				snapshotRef: snapshotId,
				path: normalizedRequestedPath,
			};
		}

		if (
			normalizedRequestedPath === "/" ||
			isSameSnapshotPath(normalizedRequestedPath, basePath, source.sourcePathKind)
		) {
			return {
				snapshotRef: `${snapshotId}:${basePath}`,
				path: "/",
			};
		}

		if (isSnapshotPathWithin(normalizedRequestedPath, basePath, source.sourcePathKind)) {
			return {
				snapshotRef: `${snapshotId}:${normalizedRequestedPath}`,
				path: "/",
			};
		}

		const relativePath = getRelativeSnapshotPath(basePath, normalizedRequestedPath, source.sourcePathKind);
		if (relativePath === undefined) {
			throw new SnapshotDumpPlanningError("Requested path is outside the snapshot base path");
		}

		return {
			snapshotRef: `${snapshotId}:${basePath}`,
			path: relativePath ? `/${relativePath}` : "/",
		};
	};

	return {
		source,
		browser: {
			initialQueryPath: () => source.queryBasePath,
			toDisplayPath: (snapshotPath: string) => {
				const normalizedSnapshotPath = toResticSnapshotPath(snapshotPath);
				const displayBasePath = getEffectiveDisplayBasePath();

				if (displayBasePath === "/") return normalizedSnapshotPath;
				if (isSameSnapshotPath(displayBasePath, normalizedSnapshotPath, source.sourcePathKind)) return "/";
				if (isSnapshotPathWithin(displayBasePath, normalizedSnapshotPath, source.sourcePathKind)) {
					return normalizedSnapshotPath.slice(displayBasePath.length) || "/";
				}

				return normalizedSnapshotPath;
			},
			toSnapshotPath: (displayPath: string) => {
				const normalizedDisplayPath = toResticSnapshotPath(displayPath);
				const displayBasePath = getEffectiveDisplayBasePath();

				if (displayBasePath === "/") return normalizedDisplayPath;
				if (normalizedDisplayPath === "/") return displayBasePath;
				return `${displayBasePath}${normalizedDisplayPath}`;
			},
			isDisplayBaseCompatible,
		},
		restore: {
			plan: restorePlan,
			targetPlan: restoreTargetPlan,
		},
		dump: {
			plan: dumpPlan,
		},
	};
};
