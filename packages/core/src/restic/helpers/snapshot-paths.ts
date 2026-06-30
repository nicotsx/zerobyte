import { findCommonAncestor } from "../../utils/common-ancestor";
import { isWindowsHostPath, windowsHostPathToResticSnapshotPath } from "../../utils/path";

export type HostPathKind = "posix" | "windows";
export type SnapshotSourcePathKind = HostPathKind | "unsupported";

const windowsResticSnapshotPathPattern = /^\/[A-Z](?:\/|$)/;
const windowsResticSnapshotPathSyntaxPattern = /^\/[A-Za-z](?:\/|$)/;

const stripTrailingSlashes = (value: string): string => {
	let end = value.length;
	while (end > 1 && value[end - 1] === "/") {
		end--;
	}
	return value.slice(0, end);
};

export const isWindowsResticSnapshotPath = (value: string): boolean =>
	windowsResticSnapshotPathPattern.test(stripTrailingSlashes(value));

export const isWindowsSnapshotPath = (value?: string): boolean => {
	if (!value) return false;
	return windowsHostPathToResticSnapshotPath(value) !== undefined || isWindowsResticSnapshotPath(value);
};

export const isPosixSnapshotPath = (value: string): boolean => {
	if (!value.startsWith("/")) return false;
	return !isWindowsResticSnapshotPath(value);
};

export const isUnsupportedNativeSnapshotPath = (value: string): boolean =>
	!value.startsWith("/") && !isWindowsHostPath(value);

export const toResticSnapshotPath = (value: string): string =>
	windowsHostPathToResticSnapshotPath(value) ?? stripTrailingSlashes(value.trim() ? value : "/");

export const toWindowsResticSnapshotPath = (value: string): string | undefined => {
	const hostPath = windowsHostPathToResticSnapshotPath(value);
	if (hostPath) return hostPath;

	const resticPath = toResticSnapshotPath(value);
	return windowsResticSnapshotPathSyntaxPattern.test(resticPath) ? resticPath : undefined;
};

export const findWindowsResticCommonAncestor = (paths: string[]): string | undefined => {
	const resticPaths: string[] = [];
	for (const snapshotPath of paths) {
		const resticPath = toWindowsResticSnapshotPath(snapshotPath);
		if (!resticPath) return undefined;
		resticPaths.push(resticPath);
	}

	const drive = resticPaths[0]?.split("/")[1];
	if (!drive || resticPaths.some((resticPath) => resticPath.split("/")[1]?.toLowerCase() !== drive.toLowerCase())) {
		return undefined;
	}

	const splitPaths = resticPaths.map((resticPath) => resticPath.split("/").filter(Boolean));
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

	return commonParts.length ? `/${commonParts.join("/")}` : undefined;
};

const splitRelativePath = (value: string): string[] => {
	return stripTrailingSlashes(value).split("/").filter(Boolean);
};

export const getPosixRelativePath = (basePath: string, targetPath: string): string => {
	const baseParts = splitRelativePath(basePath);
	const targetParts = splitRelativePath(targetPath);

	let commonLength = 0;
	while (
		commonLength < baseParts.length &&
		commonLength < targetParts.length &&
		baseParts[commonLength] === targetParts[commonLength]
	) {
		commonLength++;
	}

	const upParts = Array.from({ length: baseParts.length - commonLength }, () => "..");
	return [...upParts, ...targetParts.slice(commonLength)].join("/");
};

const isWindowsComparison = (
	basePath: string,
	targetPath: string,
	sourcePathKind?: SnapshotSourcePathKind,
): boolean => {
	if (sourcePathKind) return sourcePathKind === "windows";
	return isWindowsHostPath(basePath) || isWindowsHostPath(targetPath);
};

export const getRelativeResticPath = (
	basePath: string,
	targetPath: string,
	sourcePathKind?: SnapshotSourcePathKind,
): string => {
	const useWindowsComparison = isWindowsComparison(basePath, targetPath, sourcePathKind);
	const normalizedBasePath = toResticSnapshotPath(basePath);
	const normalizedTargetPath = toResticSnapshotPath(targetPath);

	if (useWindowsComparison && normalizedBasePath.startsWith("/") && normalizedTargetPath.startsWith("/")) {
		if (normalizedBasePath === "/") return normalizedTargetPath.replace(/^\/+/, "");

		const lowerBasePath = normalizedBasePath.toLowerCase();
		const lowerTargetPath = normalizedTargetPath.toLowerCase();
		if (lowerTargetPath === lowerBasePath) return "";
		if (lowerTargetPath.startsWith(`${lowerBasePath}/`)) {
			return normalizedTargetPath.slice(normalizedBasePath.length).replace(/^\/+/, "");
		}
	}

	return getPosixRelativePath(normalizedBasePath, normalizedTargetPath);
};

const findRelativeCommonAncestor = (paths: string[]): string => {
	if (paths.length === 0) return "/";
	if (paths.length === 1) return paths[0] || "/";

	const splitPaths = paths.map((snapshotPath) => snapshotPath.split("/").filter(Boolean));
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

export const findResticCommonAncestor = (snapshotPaths: string[], sourcePathKind?: SnapshotSourcePathKind): string => {
	const resticPaths = snapshotPaths.map(toResticSnapshotPath);
	const absolutePaths = resticPaths.filter((snapshotPath) => snapshotPath.startsWith("/"));

	if (absolutePaths.length === resticPaths.length) {
		if (sourcePathKind === "windows") {
			return findWindowsResticCommonAncestor(resticPaths) ?? "/";
		}

		return findCommonAncestor(resticPaths);
	}

	if (absolutePaths.length > 0) {
		throw new Error("Snapshot paths must use a single path format.");
	}

	return findRelativeCommonAncestor(resticPaths);
};

const getResticParentPath = (snapshotPath: string): string => {
	const resticPath = toResticSnapshotPath(snapshotPath);

	if (!resticPath.startsWith("/")) {
		const withoutTrailingSlash = stripTrailingSlashes(resticPath);
		const lastSlashIndex = withoutTrailingSlash.lastIndexOf("/");

		if (lastSlashIndex < 0) return ".";
		if (lastSlashIndex === 0) return "/";
		return withoutTrailingSlash.slice(0, lastSlashIndex);
	}

	const normalizedPath = stripTrailingSlashes(resticPath);
	const lastSlashIndex = normalizedPath.lastIndexOf("/");

	if (lastSlashIndex <= 0) return "/";
	return normalizedPath.slice(0, lastSlashIndex);
};

export const getResticRestoreRoot = (
	includes: string[],
	selectedItemKind?: "file" | "dir",
	sourcePathKind?: SnapshotSourcePathKind,
): string => {
	if (selectedItemKind === "file" && includes.length === 1) {
		return getResticParentPath(includes[0] ?? "/");
	}

	return findResticCommonAncestor(includes, sourcePathKind);
};
