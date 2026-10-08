import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Effect } from "effect";
import { expect, test } from "vitest";
import { createBackupOptions } from "@zerobyte/core/backup-hooks";
import { resticBackupOutputSchema, type RepositoryConfig } from "@zerobyte/core/restic";
import { resolveBackupTargets } from "@zerobyte/core/restic/server";
import { INTEGRATION_ORGANIZATION_ID } from "./constants";
import { createIntegrationRestic } from "./helpers/restic";

type SelectionScenario = {
	name: string;
	includePaths?: string[];
	includePatterns?: string[];
	excludePatterns?: string[];
	excludeIfPresent?: string[];
	expectedFiles?: string[];
};

const scenarios: SelectionScenario[] = [
	{ name: "full source" },
	{ name: "wildcards and dotfiles", includePatterns: ["*.txt"] },
	{ name: "Unicode question marks", includePatterns: ["?.txt", "??.txt"] },
	{ name: "byte offsets after a star", includePatterns: ["*??.txt"] },
	{ name: "consecutive star chunks", includePatterns: ["*?*?.txt"] },
	{
		name: "classes and escaped literals",
		includePatterns: ["report[12].txt", "report\\[1\\].txt", "report\\*.txt"],
		expectedFiles: ["report1.txt", "report2.txt", "report[1].txt", "report*.txt"],
	},
	{
		name: "double stars select one directory level",
		includePatterns: ["**/*.txt"],
		expectedFiles: ["docs/readme.txt", "skipped/secret.txt"],
	},
	{ name: "selected directories are recursive", includePatterns: ["**"] },
	{
		name: "literal filenames keep metacharacters, line breaks, and trailing spaces",
		includePaths: ["report[1].txt", "line\nbreak.txt", "trailing.txt "],
		expectedFiles: ["report[1].txt", "line\nbreak.txt", "trailing.txt "],
	},
	{
		name: "literal directory names keep metacharacters",
		includePaths: ["/photos [1]"],
		expectedFiles: ["photos [1]/picture.jpg"],
	},
	{
		name: "relative and source-rooted selections combine with negated includes",
		includePaths: ["/docs"],
		includePatterns: ["/report[12].txt", "!*.log"],
		expectedFiles: ["docs/readme.txt", "docs/nested/deep.txt", "report1.txt", "report2.txt"],
	},
	{
		name: "unmatched patterns preserve literal selections",
		includePaths: ["a.txt"],
		includePatterns: ["missing*.txt"],
		expectedFiles: ["a.txt"],
	},
	{
		name: "pattern whitespace keeps Restic's trimming",
		includePatterns: [" leading.txt", "trailing.txt ", "trailing.txt\u0085", "trailing.txt\ufeff"],
		expectedFiles: [" leading.txt", "trailing.txt", "trailing.txt\ufeff"],
	},
	{
		name: "relative and source-rooted excludes",
		includePaths: ["docs", "logs"],
		excludePatterns: ["/docs/nested", "*.log"],
		expectedFiles: ["docs/readme.txt"],
	},
	{
		name: "negated relative excludes",
		includePaths: ["docs"],
		excludePatterns: ["*.txt", "!readme.txt"],
		expectedFiles: ["docs/readme.txt"],
	},
	{
		name: "exclude markers",
		includePaths: ["docs", "skipped"],
		excludeIfPresent: [".nobackup"],
		expectedFiles: ["docs/readme.txt", "docs/nested/deep.txt", "skipped/.nobackup"],
	},
];

test("trusted selection preserves files backed up by Restic's original files-from selection", async () => {
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-selection-integration-"));
	const sourcePath = path.join(await fs.realpath(workspace), "source");
	const password = crypto.randomBytes(16).toString("hex");
	const repositoryConfig: RepositoryConfig = { backend: "local", path: path.join(workspace, "repository") };
	const restic = createIntegrationRestic(workspace, password);
	const names = [
		"a.txt",
		"ab.txt",
		"é.txt",
		"éé.txt",
		"😀.txt",
		"😀😀.txt",
		"report1.txt",
		"report2.txt",
		"report[1].txt",
		"report*.txt",
		".hidden.txt",
		"#report.txt",
		" leading.txt",
		"trailing.txt",
		"trailing.txt ",
		"trailing.txt\u0085",
		"trailing.txt\ufeff",
		"line\nbreak.txt",
		"logs/debug.log",
		"docs/readme.txt",
		"docs/nested/deep.txt",
		"photos [1]/picture.jpg",
		"skipped/.nobackup",
		"skipped/secret.txt",
	];

	try {
		for (const name of names) {
			const filename = path.join(sourcePath, name);
			await fs.mkdir(path.dirname(filename), { recursive: true });
			await fs.writeFile(filename, `backup:${name}`);
		}
		await Effect.runPromise(restic.init(repositoryConfig, { organizationId: INTEGRATION_ORGANIZATION_ID }));

		for (const scenario of scenarios) {
			const signal = new AbortController().signal;
			const options = createBackupOptions(
				{ scheduleId: scenario.name, options: { ...scenario, oneFileSystem: false, compressionMode: "auto" } },
				sourcePath,
				signal,
			);
			const args = ["--repo", repositoryConfig.path, "backup", "--json", "--tag", scenario.name];
			if (scenario.includePatterns?.length) {
				const filename = path.join(workspace, "patterns.txt");
				const patterns = scenario.includePatterns.map((pattern) =>
					pattern.startsWith("!")
						? `!${path.join(sourcePath, pattern.slice(1))}`
						: path.join(sourcePath, pattern),
				);
				await fs.writeFile(filename, patterns.join("\n"));
				args.push("--files-from", filename);
			}
			if (scenario.includePaths?.length) {
				const filename = path.join(workspace, "literal.raw");
				await fs.writeFile(
					filename,
					`${scenario.includePaths.map((entry) => path.join(sourcePath, entry)).join("\0")}\0`,
				);
				args.push("--files-from-raw", filename);
			}
			for (const pattern of options.exclude ?? []) {
				args.push("--exclude", pattern);
			}
			for (const marker of options.excludeIfPresent ?? []) {
				args.push("--exclude-if-present", marker);
			}
			if (!scenario.includePaths?.length && !scenario.includePatterns?.length) {
				args.push("--", sourcePath);
			}

			const original = spawnSync("restic", args, {
				env: {
					PATH: process.env.PATH,
					RESTIC_PASSWORD: password,
					RESTIC_CACHE_DIR: path.join(workspace, "cache"),
				},
				encoding: "utf8",
			});
			expect(original.status, `${scenario.name}: ${original.stderr}`).toBe(0);
			const originalSnapshot = resticBackupOutputSchema.parse(
				JSON.parse(original.stdout.trim().split("\n").at(-1)!),
			);

			const includePaths = await resolveBackupTargets(scenario, sourcePath, sourcePath, signal);
			const current = await Effect.runPromise(
				restic.backup(repositoryConfig, sourcePath, {
					...options,
					includePaths,
					organizationId: INTEGRATION_ORGANIZATION_ID,
				}),
			);
			expect(current.exitCode, scenario.name).toBe(0);
			expect(current.result?.snapshot_id, scenario.name).toEqual(expect.any(String));

			const files: string[][] = [];
			for (const snapshotId of [originalSnapshot.snapshot_id!, current.result!.snapshot_id!]) {
				const listing = await Effect.runPromise(
					restic.ls(repositoryConfig, snapshotId, undefined, { organizationId: INTEGRATION_ORGANIZATION_ID }),
				);
				files.push(
					listing.nodes
						.filter((node) => node.type === "file")
						.map((node) => path.relative(sourcePath, node.path))
						.sort(),
				);
			}

			expect(files[1], scenario.name).toEqual(files[0]);
			if (scenario.expectedFiles) {
				expect(files[1], scenario.name).toEqual([...scenario.expectedFiles].sort());
			}
			if (scenario.name === "byte offsets after a star") {
				expect(files[1]).toContain("😀.txt");
			}
		}
	} finally {
		await fs.rm(workspace, { recursive: true, force: true });
	}
});

test.each(["missing*.txt", "!*.txt", "missing/.. ", "missing/. "])(
	"unmatched patterns fail without falling back to the full source: %j",
	async (pattern) => {
		const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-selection-unmatched-"));
		const sourcePath = path.join(await fs.realpath(workspace), "source");

		try {
			await fs.mkdir(sourcePath);
			await fs.writeFile(path.join(sourcePath, "keep.txt"), "backup");
			const filename = path.join(workspace, "patterns.txt");
			const anchoredPattern = pattern.startsWith("!")
				? `!${path.join(sourcePath, pattern.slice(1))}`
				: path.join(sourcePath, pattern);
			await fs.writeFile(filename, anchoredPattern);

			const original = spawnSync(
				"restic",
				["--repo", path.join(workspace, "repository"), "backup", "--json", "--files-from", filename],
				{ env: { PATH: process.env.PATH, RESTIC_PASSWORD: "unmatched-pattern-test" }, encoding: "utf8" },
			);
			expect(original.status, original.stderr).toBe(1);
			expect(original.stderr).toContain("nothing to backup");

			await expect(
				resolveBackupTargets(
					{ includePatterns: [pattern] },
					sourcePath,
					sourcePath,
					new AbortController().signal,
				),
			).rejects.toThrow("No trusted backup target matches the include patterns");
		} finally {
			await fs.rm(workspace, { recursive: true, force: true });
		}
	},
);
