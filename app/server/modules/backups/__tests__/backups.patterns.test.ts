import path from "node:path";
import { describe, expect, test } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { createBackupOptions } from "../backup.helpers";

type BackupScheduleInput = Parameters<typeof createBackupOptions>[0];

const createSchedule = (overrides: Partial<BackupScheduleInput> = {}): BackupScheduleInput =>
	fromAny({
		shortId: "sched-1234",
		oneFileSystem: false,
		includePaths: [],
		includePatterns: [],
		excludePatterns: [],
		excludeIfPresent: [],
		...overrides,
	}) as BackupScheduleInput;

describe("executeBackup - include / exclude patterns", () => {
	test("should correctly build include and exclude patterns", () => {
		// arrange
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";
		const schedule = createSchedule({
			includePaths: ["/Photos"],
			includePatterns: ["*.zip", "!/Temp", "!*.log"],
			excludePatterns: [".DS_Store", "/Config", "!/Important", "!*.tmp"],
			excludeIfPresent: [".nobackup"],
		});
		const signal = new AbortController().signal;

		// act
		const options = createBackupOptions(schedule, volumePath, signal);

		// assert
		expect(options).toMatchObject({
			includePaths: [path.join(volumePath, "Photos")],
			includePatterns: [
				path.join(volumePath, "*.zip"),
				`!${path.join(volumePath, "Temp")}`,
				`!${path.join(volumePath, "*.log")}`,
			],
			exclude: [".DS_Store", path.join(volumePath, "Config"), `!${path.join(volumePath, "Important")}`, "!*.tmp"],
			excludeIfPresent: [".nobackup"],
		});
	});

	test("should handle empty include and exclude patterns", () => {
		// arrange
		const schedule = createSchedule({
			includePatterns: [],
			excludePatterns: [],
		});
		const signal = new AbortController().signal;

		// act
		const options = createBackupOptions(schedule, "/var/lib/zerobyte/volumes/vol999/_data", signal);

		// assert
		expect(options.includePaths).toEqual([]);
		expect(options.includePatterns).toEqual([]);
		expect(options.exclude).toEqual([]);
	});
});
