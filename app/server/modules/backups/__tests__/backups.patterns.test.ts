import { test, describe, expect } from "bun:test";
import path from "node:path";
import { fromAny } from "@total-typescript/shoehorn";
import { createBackupOptions, processPattern } from "../backup.helpers";

type BackupScheduleInput = Parameters<typeof createBackupOptions>[0];

const createSchedule = (overrides: Partial<BackupScheduleInput> = {}): BackupScheduleInput =>
	fromAny({
		shortId: "sched-1234",
		oneFileSystem: false,
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
			includePatterns: ["*.zip", "/Photos", "!/Temp", "!*.log"],
			excludePatterns: [".DS_Store", "/Config", "!/Important", "!*.tmp"],
			excludeIfPresent: [".nobackup"],
		});
		const signal = new AbortController().signal;

		// act
		const options = createBackupOptions(schedule, volumePath, signal);

		// assert
		expect(options).toMatchObject({
			include: [
				path.join(volumePath, "*.zip"),
				path.join(volumePath, "Photos"),
				`!${path.join(volumePath, "Temp")}`,
				`!${path.join(volumePath, "*.log")}`,
			],
			exclude: [".DS_Store", path.join(volumePath, "Config"), `!${path.join(volumePath, "Important")}`, "!*.tmp"],
			excludeIfPresent: [".nobackup"],
		});
	});

	test("should handle the case where a subfolder has the exact same name as the volume name", () => {
		// arrange
		const volumeName = "SyncFolder";
		const volumePath = `/${volumeName}`;
		const selectedPath = `/${volumeName}`;
		const schedule = createSchedule({
			includePatterns: [selectedPath],
		});
		const signal = new AbortController().signal;

		// act
		const options = createBackupOptions(schedule, volumePath, signal);

		// assert
		expect(options.include).toEqual([path.join(volumePath, volumeName)]);
	});

	test("should correctly mix relative and absolute patterns", () => {
		// arrange
		const volumePath = "/var/lib/zerobyte/volumes/vol456/_data";
		const relativeInclude = "relative/include";
		const anchoredInclude = "/anchored/include";
		const schedule = createSchedule({
			includePatterns: [relativeInclude, anchoredInclude],
		});
		const signal = new AbortController().signal;

		// act
		const options = createBackupOptions(schedule, volumePath, signal);

		// assert
		expect(options.include).toEqual([
			path.join(volumePath, relativeInclude),
			path.join(volumePath, "anchored/include"),
		]);
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
		expect(options.include).toEqual([]);
		expect(options.exclude).toEqual([]);
	});

	test("processPattern keeps relative and negated relative patterns unchanged", () => {
		expect(processPattern("relative/include", "/volume")).toBe("relative/include");
		expect(processPattern("!*.log", "/volume")).toBe("!*.log");
	});

	test("anchors relative glob include patterns to the volume path", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";
		const schedule = createSchedule({
			includePatterns: ["**/*.xyz", "*.zip", "!**/*.tmp"],
		});
		const signal = new AbortController().signal;

		const options = createBackupOptions(schedule, volumePath, signal);

		expect(options.include).toEqual([
			path.join(volumePath, "**/*.xyz"),
			path.join(volumePath, "*.zip"),
			`!${path.join(volumePath, "**/*.tmp")}`,
		]);
	});
});
