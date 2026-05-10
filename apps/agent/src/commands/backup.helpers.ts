import path from "node:path";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";

type BackupOptions = BackupRunPayload["options"];

export const processPattern = (pattern: string, volumePath: string, relative = false) => {
	const isNegated = pattern.startsWith("!");
	const p = isNegated ? pattern.slice(1) : pattern;

	const ensurePatternIsWithinVolume = (candidate: string) => {
		const resolvedVolumePath = path.resolve(volumePath);
		const resolvedCandidatePath = path.resolve(volumePath, candidate);
		const relativePath = path.relative(resolvedVolumePath, resolvedCandidatePath);

		if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
			throw new Error(`Include pattern escapes volume root: ${pattern}`);
		}
	};

	if (!p.startsWith("/")) {
		if (!relative) return pattern;
		ensurePatternIsWithinVolume(p);
		const processed = path.join(volumePath, p);
		return isNegated ? `!${processed}` : processed;
	}

	if (relative) {
		ensurePatternIsWithinVolume(p.slice(1));
	}
	const processed = path.join(volumePath, p.slice(1));
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
	exclude: params.options.excludePatterns?.map((p) => processPattern(p, volumePath)) ?? undefined,
	excludeIfPresent: params.options.excludeIfPresent ?? undefined,
	includePaths: params.options.includePaths?.map((p) => processPattern(p, volumePath, true)) ?? undefined,
	includePatterns: params.options.includePatterns?.map((p) => processPattern(p, volumePath, true)) ?? undefined,
	customResticParams: params.options.customResticParams ?? [],
	compressionMode: params.options.compressionMode,
});
