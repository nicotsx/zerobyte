import path from "node:path";
import { hasPathListSeparator } from "../utils/index.js";

type BackupOptions = {
	oneFileSystem: boolean;
	excludePatterns?: string[] | null;
	excludeIfPresent?: string[] | null;
	includePaths?: string[] | null;
	includePatterns?: string[] | null;
	customResticParams?: string[] | null;
	compressionMode: "auto" | "off" | "max";
};

const validateIncludeEntry = (entry: string, name: string, format: "raw" | "text") => {
	if (hasPathListSeparator(entry, format)) {
		throw new Error(`${name} contains an unsupported path character: ${entry}`);
	}
};

export const processBackupPattern = (pattern: string, volumePath: string, relative = false) => {
	const isNegated = pattern.startsWith("!");
	const value = isNegated ? pattern.slice(1) : pattern;

	const ensurePatternIsWithinVolume = (candidate: string) => {
		const resolvedVolumePath = path.resolve(volumePath);
		const resolvedCandidatePath = path.resolve(volumePath, candidate);
		const relativePath = path.relative(resolvedVolumePath, resolvedCandidatePath);
		const escapesRoot =
			relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
		if (escapesRoot) {
			throw new Error(`Include pattern escapes volume root: ${pattern}`);
		}
	};

	if (!value.startsWith("/")) {
		if (!relative) return pattern;
		ensurePatternIsWithinVolume(value);
		const processed = path.join(volumePath, value);
		return isNegated ? `!${processed}` : processed;
	}

	if (relative) ensurePatternIsWithinVolume(value.slice(1));
	const processed = path.join(volumePath, value.slice(1));
	return isNegated ? `!${processed}` : processed;
};

export const createBackupOptions = (
	params: { scheduleId: string; options: BackupOptions },
	volumePath: string,
	signal?: AbortSignal,
) => ({
	tags: [params.scheduleId],
	oneFileSystem: params.options.oneFileSystem,
	signal,
	exclude: params.options.excludePatterns?.map((pattern) => processBackupPattern(pattern, volumePath)) ?? undefined,
	excludeIfPresent: params.options.excludeIfPresent ?? undefined,
	includePaths:
		params.options.includePaths?.map((includePath) => {
			validateIncludeEntry(includePath, "Include path", "raw");
			return processBackupPattern(includePath, volumePath, true);
		}) ?? undefined,
	includePatterns:
		params.options.includePatterns?.map((pattern) => {
			validateIncludeEntry(pattern, "Include pattern", "text");
			return processBackupPattern(pattern, volumePath, true);
		}) ?? undefined,
	customResticParams: params.options.customResticParams ?? [],
	compressionMode: params.options.compressionMode,
});
