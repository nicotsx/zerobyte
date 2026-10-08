import path from "node:path";
import { expect, test } from "vitest";
import { createBackupOptions, processBackupPattern } from "../options";

test("builds backup options with anchored excludes and schedule tags", () => {
	const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";
	const signal = new AbortController().signal;
	const options = createBackupOptions(
		{
			scheduleId: "schedule-1",
			options: {
				oneFileSystem: true,
				excludePatterns: [".DS_Store", "/Config", "!/Important", "!*.tmp"],
				excludeIfPresent: [".nobackup"],
				customResticParams: ["--skip-if-unchanged"],
				compressionMode: "max",
			},
		},
		volumePath,
		signal,
	);

	expect(options).toEqual({
		tags: ["schedule-1"],
		oneFileSystem: true,
		signal,
		exclude: [".DS_Store", path.join(volumePath, "Config"), `!${path.join(volumePath, "Important")}`, "!*.tmp"],
		excludeIfPresent: [".nobackup"],
		customResticParams: ["--skip-if-unchanged"],
		compressionMode: "max",
	});
});

test.each(["relative/include", "!*.log", ""])("keeps relative exclude pattern %j unchanged", (pattern) => {
	expect(processBackupPattern(pattern, "/volume")).toBe(pattern);
});

test("keeps an empty exclude list", () => {
	const options = createBackupOptions(
		{ scheduleId: "schedule-1", options: { oneFileSystem: false, excludePatterns: [], compressionMode: "auto" } },
		"/volume",
	);

	expect(options.exclude).toEqual([]);
});
