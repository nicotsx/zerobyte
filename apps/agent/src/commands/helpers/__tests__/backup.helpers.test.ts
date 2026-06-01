import path from "node:path";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { createBackupOptions, processPattern } from "../backup.helpers";

type BackupPathOptions = BackupRunPayload["options"];

const safePatternSegmentArb = fc
	.array(fc.constantFrom("a", "b", "c", "x", "y", "z", "0", "1", "2", "-", "_", ".", " "), {
		minLength: 1,
		maxLength: 12,
	})
	.map((chars) => chars.join(""))
	.filter((segment) => segment.trim() !== "" && segment !== "." && segment !== "..");

const safeRelativePatternArb = fc
	.array(safePatternSegmentArb, { minLength: 1, maxLength: 5 })
	.map((segments) => segments.join("/"));

const createPathOptions = (overrides: Partial<BackupPathOptions> = {}): BackupPathOptions => ({
	oneFileSystem: false,
	includePaths: [],
	includePatterns: [],
	excludePatterns: [],
	excludeIfPresent: [],
	customResticParams: [],
	compressionMode: "auto",
	...overrides,
});

const createOptions = (options: BackupPathOptions, volumePath: string, signal?: AbortSignal) =>
	createBackupOptions({ scheduleId: "sched-1234", options }, volumePath, signal);

describe("backup path options", () => {
	test("builds include and exclude patterns", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";
		const signal = new AbortController().signal;

		const options = createOptions(
			createPathOptions({
				includePaths: ["/Photos"],
				includePatterns: ["*.zip", "!/Temp", "!*.log"],
				excludePatterns: [".DS_Store", "/Config", "!/Important", "!*.tmp"],
				excludeIfPresent: [".nobackup"],
			}),
			volumePath,
			signal,
		);

		expect(options).toMatchObject({
			tags: ["sched-1234"],
			signal,
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

	test("keeps relative and negated relative exclude patterns unchanged", () => {
		expect(processPattern("relative/include", "/volume")).toBe("relative/include");
		expect(processPattern("!*.log", "/volume")).toBe("!*.log");
	});

	test("anchors relative glob include patterns to the volume path", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";
		const options = createOptions(
			createPathOptions({ includePatterns: ["**/*.xyz", "*.zip", "!**/*.tmp"] }),
			volumePath,
		);

		expect(options.includePatterns).toEqual([
			path.join(volumePath, "**/*.xyz"),
			path.join(volumePath, "*.zip"),
			`!${path.join(volumePath, "**/*.tmp")}`,
		]);
	});

	test("handles a selected subfolder with the exact same name as the volume path", () => {
		const volumeName = "SyncFolder";
		const volumePath = `/${volumeName}`;

		const options = createOptions(createPathOptions({ includePaths: [`/${volumeName}`] }), volumePath);

		expect(options.includePaths).toEqual([path.join(volumePath, volumeName)]);
	});

	test("mixes relative and absolute include patterns", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol456/_data";
		const relativeInclude = "relative/include";
		const anchoredInclude = "/anchored/include";

		const options = createOptions(
			createPathOptions({ includePatterns: [relativeInclude, anchoredInclude] }),
			volumePath,
		);

		expect(options.includePatterns).toEqual([
			path.join(volumePath, relativeInclude),
			path.join(volumePath, "anchored/include"),
		]);
	});

	test("handles empty include and exclude patterns", () => {
		const options = createOptions(
			createPathOptions({ includePatterns: [], excludePatterns: [] }),
			"/var/lib/zerobyte/volumes/vol999/_data",
		);

		expect(options.includePaths).toEqual([]);
		expect(options.includePatterns).toEqual([]);
		expect(options.exclude).toEqual([]);
	});

	test("rejects include patterns that escape the volume root", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";

		expect(() =>
			createOptions(
				createPathOptions({
					includePatterns: ["../../../../etc/shadow", "/../etc/passwd", "!/../../secrets.txt"],
				}),
				volumePath,
			),
		).toThrow("Include pattern escapes volume root");
	});

	test("rejects unsupported characters in selected include paths", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";

		for (const includePath of ["/Photos\0/etc/passwd", "/Photos\n/etc/passwd", "/Photos\r/etc/passwd"]) {
			expect(() => createOptions(createPathOptions({ includePaths: [includePath] }), volumePath)).toThrow(
				"Include pattern contains an unsupported path character",
			);
		}
	});

	test("rejects unsupported characters in include patterns", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";

		expect(() =>
			createOptions(createPathOptions({ includePatterns: ["/Photos\n/etc/passwd"] }), volumePath),
		).toThrow("Include pattern contains an unsupported path character");
	});

	test("anchors generated include patterns under the volume path", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";

		fc.assert(
			fc.property(safeRelativePatternArb, fc.boolean(), fc.boolean(), (pattern, anchored, negated) => {
				const rawPattern = `${negated ? "!" : ""}${anchored ? "/" : ""}${pattern}`;
				const expected = path.join(volumePath, pattern);

				expect(processPattern(rawPattern, volumePath, true)).toBe(negated ? `!${expected}` : expected);
			}),
		);
	});

	test("rejects generated include patterns that escape the volume root", () => {
		const volumePath = "/volume/root";

		fc.assert(
			fc.property(safeRelativePatternArb, fc.boolean(), (pattern, negated) => {
				const escapingPattern = `${negated ? "!" : ""}${"../".repeat(8)}${pattern}`;

				expect(() => processPattern(escapingPattern, volumePath, true)).toThrow(
					"Include pattern escapes volume root",
				);
			}),
		);
	});

	test("keeps selected include paths separate from include patterns", () => {
		const volumePath = "/var/lib/zerobyte/volumes/vol123/_data";

		const options = createOptions(
			createPathOptions({ includePaths: ["/movies [1]"], includePatterns: ["**/*.txt"] }),
			volumePath,
		);

		expect(options.includePaths).toEqual([path.join(volumePath, "movies [1]")]);
		expect(options.includePatterns).toEqual([path.join(volumePath, "**/*.txt")]);
	});
});
