import path from "node:path";

type BackupOptions = {
	oneFileSystem: boolean;
	excludePatterns?: string[] | null;
	excludeIfPresent?: string[] | null;
	customResticParams?: string[] | null;
	compressionMode: "auto" | "off" | "max";
};

export const processBackupPattern = (pattern: string, volumePath: string) => {
	const isNegated = pattern.startsWith("!");
	const value = isNegated ? pattern.slice(1) : pattern;

	if (!value.startsWith("/")) {
		return pattern;
	}

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
	customResticParams: params.options.customResticParams ?? [],
	compressionMode: params.options.compressionMode,
});
