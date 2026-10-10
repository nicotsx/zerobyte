import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import fc from "fast-check";
import { resolveBackupTargets } from "../backup-selection";

test("anchors literal selections and patterns to the source while keeping glob characters literal in paths", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-options-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	fs.mkdirSync(path.join(sourcePath, "photos [1]"));
	fs.mkdirSync(path.join(sourcePath, "nested"));
	fs.writeFileSync(path.join(sourcePath, "nested", "report.txt"), "report");

	try {
		const targets = await resolveBackupTargets(
			{ includePaths: ["/photos [1]"], includePatterns: ["/nested/*.txt", "!*.log"] },
			canonicalSourcePath,
			canonicalSourcePath,
			new AbortController().signal,
		);

		expect(targets).toEqual([
			path.join(canonicalSourcePath, "photos [1]"),
			path.join(canonicalSourcePath, "nested", "report.txt"),
		]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test.each(["SyncFolder", "/SyncFolder"])(
	"selects a subfolder with the same name as its source: %j",
	async (selection) => {
		const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-same-name-"));
		const sourcePath = path.join(parentPath, "SyncFolder");
		fs.mkdirSync(path.join(sourcePath, "SyncFolder"), { recursive: true });
		const canonicalSourcePath = fs.realpathSync.native(sourcePath);

		try {
			const targets = await resolveBackupTargets(
				{ includePaths: [selection] },
				canonicalSourcePath,
				canonicalSourcePath,
				new AbortController().signal,
			);

			expect(targets).toEqual([path.join(canonicalSourcePath, "SyncFolder")]);
		} finally {
			fs.rmSync(parentPath, { recursive: true, force: true });
		}
	},
);

test("combines relative and source-rooted include patterns", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-mixed-patterns-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	fs.mkdirSync(path.join(sourcePath, "relative"));
	fs.mkdirSync(path.join(sourcePath, "anchored"));
	fs.writeFileSync(path.join(sourcePath, "relative", "report.txt"), "relative");
	fs.writeFileSync(path.join(sourcePath, "anchored", "report.txt"), "anchored");

	try {
		const targets = await resolveBackupTargets(
			{ includePatterns: ["relative/*.txt", "/anchored/*.txt"] },
			canonicalSourcePath,
			canonicalSourcePath,
			new AbortController().signal,
		);

		expect(targets).toEqual([
			path.join(canonicalSourcePath, "relative", "report.txt"),
			path.join(canonicalSourcePath, "anchored", "report.txt"),
		]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test.each([{}, { includePaths: [], includePatterns: [] }, { includePaths: null, includePatterns: null }])(
	"leaves selection empty for a full-source backup: %j",
	async (options) => {
		await expect(
			resolveBackupTargets(options, "/source", "/source", new AbortController().signal),
		).resolves.toEqual([]);
	},
);

test("anchors generated literal selections and patterns beneath the source", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-generated-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const signal = new AbortController().signal;
	const pathSegments = fc.array(
		fc
			.stringMatching(/^[a-z0-9 _.-]{1,12}$/)
			.filter((segment) => segment.trim() !== "" && segment !== "." && segment !== ".."),
		{ minLength: 1, maxLength: 5 },
	);

	try {
		await fc.assert(
			fc.asyncProperty(pathSegments, fc.boolean(), async (segments, rooted) => {
				const targetPath = path.join(canonicalSourcePath, ...segments);
				const selection = `${rooted ? "/" : ""}${segments.join("/")}`;
				fs.mkdirSync(targetPath, { recursive: true });

				await expect(
					resolveBackupTargets(
						{ includePaths: [selection] },
						canonicalSourcePath,
						canonicalSourcePath,
						signal,
					),
				).resolves.toEqual([targetPath]);

				const patternTargetPath = path.resolve(
					canonicalSourcePath,
					...segments.slice(0, -1),
					segments.at(-1)!.trimEnd(),
				);
				if (path.relative(canonicalSourcePath, patternTargetPath) === "..") {
					await expect(
						resolveBackupTargets(
							{ includePatterns: [selection] },
							canonicalSourcePath,
							canonicalSourcePath,
							signal,
						),
					).rejects.toThrow("escapes source path");
				} else {
					fs.mkdirSync(patternTargetPath, { recursive: true });
					await expect(
						resolveBackupTargets(
							{ includePatterns: [selection] },
							canonicalSourcePath,
							canonicalSourcePath,
							signal,
						),
					).resolves.toEqual([patternTargetPath]);
				}
			}),
		);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("rejects selections that traverse outside the source", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-traversal-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const signal = new AbortController().signal;

	try {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 1, max: 8 }), fc.boolean(), async (depth, negated) => {
				const escape = `${"../".repeat(depth)}outside`;
				await expect(
					resolveBackupTargets({ includePaths: [escape] }, canonicalSourcePath, canonicalSourcePath, signal),
				).rejects.toThrow("escapes source path");
				await expect(
					resolveBackupTargets(
						{ includePatterns: [`${negated ? "!" : ""}/${escape}`] },
						canonicalSourcePath,
						canonicalSourcePath,
						signal,
					),
				).rejects.toThrow("escapes source path");
			}),
		);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test.each([
	{ includePaths: ["photos\0private"] },
	{ includePatterns: ["photos\0private"] },
	{ includePatterns: ["photos\nprivate"] },
	{ includePatterns: ["photos\rprivate"] },
])("rejects unsupported selection characters: %j", async (options) => {
	await expect(resolveBackupTargets(options, "/source", "/source", new AbortController().signal)).rejects.toThrow(
		"unsupported path character",
	);
});

test("expands patterns beneath a trusted source whose name contains Go glob characters", async () => {
	const parentPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const sourcePath = path.join(parentPath, "allowed[12]");
	const siblingPath = path.join(parentPath, "allowed1");
	const sourceMarkerPath = path.join(sourcePath, "marker.txt");
	const siblingMarkerPath = path.join(siblingPath, "marker.txt");
	fs.mkdirSync(sourcePath);
	fs.mkdirSync(siblingPath);
	fs.writeFileSync(sourceMarkerPath, "trusted");
	fs.writeFileSync(siblingMarkerPath, "outside");
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const canonicalSourceMarkerPath = path.join(canonicalSourcePath, "marker.txt");
	const signal = new AbortController().signal;

	try {
		const selection = await resolveBackupTargets(
			{ includePatterns: ["*.txt"] },
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection).toEqual([canonicalSourceMarkerPath]);
	} finally {
		fs.rmSync(parentPath, { recursive: true, force: true });
	}
});

test("rejects intermediate-symlink targets for literal and Go-pattern paths", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const sourcePath = path.join(rootPath, "allowed");
	const outsidePath = path.join(rootPath, "outside");
	const markerPath = path.join(outsidePath, "marker.txt");
	const linkPath = path.join(sourcePath, "link");
	fs.mkdirSync(sourcePath);
	fs.mkdirSync(outsidePath);
	fs.writeFileSync(markerPath, "outside");
	fs.symlinkSync(outsidePath, linkPath, "dir");
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const patterns = [
		path.join(canonicalSourcePath, "link", "marker.txt"),
		path.join(canonicalSourcePath, "l[ij]nk", "marker.txt"),
		path.join(canonicalSourcePath, "link", "ma?ker.txt"),
		path.join(canonicalSourcePath, "link", "**"),
		path.join(canonicalSourcePath, "link", "\\marker.txt"),
	];
	const signal = new AbortController().signal;

	try {
		for (const pattern of patterns) {
			await expect(
				resolveBackupTargets(
					{ includePatterns: [path.relative(canonicalSourcePath, pattern)] },
					canonicalSourcePath,
					canonicalSourcePath,
					signal,
				),
			).rejects.toThrow("Trusted backup selection escapes its configured root");
		}
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("preserves Go character classes and escapes when selecting trusted targets", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const sourcePath = path.join(rootPath, "allowed");
	fs.mkdirSync(sourcePath);
	fs.writeFileSync(path.join(sourcePath, "report1.txt"), "one");
	fs.writeFileSync(path.join(sourcePath, "report2.txt"), "two");
	fs.writeFileSync(path.join(sourcePath, "report[1].txt"), "literal");
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const signal = new AbortController().signal;

	try {
		const selection = await resolveBackupTargets(
			{
				includePatterns: ["report[12].txt", "report\\[1\\].txt"],
			},
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection).toEqual([
			path.join(canonicalSourcePath, "report1.txt"),
			path.join(canonicalSourcePath, "report2.txt"),
			path.join(canonicalSourcePath, "report[1].txt"),
		]);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test.each([
	{ pattern: "*.txt", names: [".hidden.txt", "visible.txt", "other.log"], selected: [".hidden.txt", "visible.txt"] },
	{ pattern: "?.txt", names: ["😀.txt", "é.txt", "ab.txt"], selected: ["é.txt", "😀.txt"] },
	{ pattern: "??.txt", names: ["😀.txt", "ab.txt", "éx.txt"], selected: ["ab.txt", "éx.txt"] },
	{
		pattern: "*??.txt",
		names: ["a.txt", "é.txt", "😀.txt", "ab.txt", "éé.txt", "�.txt"],
		selected: ["ab.txt", "éé.txt", "�.txt", "😀.txt"],
	},
	{
		pattern: "*?*?.txt",
		names: ["a.txt", "é.txt", "😀.txt", "ab.txt", "éé.txt", "😀😀.txt"],
		selected: ["ab.txt", "éé.txt", "😀😀.txt"],
	},
	{ pattern: "plain.txt ", names: ["plain.txt", "plain.txt "], selected: ["plain.txt"] },
	{ pattern: "plain.txt\u0085", names: ["plain.txt", "plain.txt\u0085"], selected: ["plain.txt"] },
	{ pattern: "plain.txt\ufeff", names: ["plain.txt", "plain.txt\ufeff"], selected: ["plain.txt\ufeff"] },
	...Array.from(
		"\t\v\f \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000",
		(whitespace) => ({
			pattern: `plain.txt${whitespace}${whitespace}`,
			names: ["plain.txt"],
			selected: ["plain.txt"],
		}),
	),
	{ pattern: "missing/.. ", names: ["keep.txt"], selected: [] },
	{ pattern: "missing/. ", names: ["keep.txt"], selected: [] },
	{ pattern: "[a-c].txt", names: ["a.txt", "b.txt", "c.txt", "d.txt"], selected: ["a.txt", "b.txt", "c.txt"] },
	{ pattern: "[^a].txt", names: ["a.txt", "b.txt", "😀.txt"], selected: ["b.txt", "😀.txt"] },
	{ pattern: "[!a].txt", names: ["!.txt", "a.txt", "b.txt"], selected: ["!.txt", "a.txt"] },
	{
		pattern: "[😀-🙏].txt",
		names: ["😀.txt", "😁.txt", "🙏.txt", "🚀.txt"],
		selected: ["😀.txt", "😁.txt", "🙏.txt"],
	},
	{ pattern: "[z-a].txt", names: ["a.txt", "z.txt"], selected: [] },
	{ pattern: "[[:alpha:]].txt", names: ["a.txt", "a].txt"], selected: ["a].txt"] },
	{ pattern: "{a,b}.txt", names: ["{a,b}.txt", "a.txt", "b.txt"], selected: ["{a,b}.txt"] },
	{ pattern: "+(a).txt", names: ["+(a).txt", "a.txt", "aa.txt"], selected: ["+(a).txt"] },
	{ pattern: "#*.txt", names: ["#report.txt", "report.txt"], selected: ["#report.txt"] },
	{
		pattern: "*a*b.txt",
		names: ["aaab.txt", "ab.txt", "acb.txt", "ac.txt"],
		selected: ["aaab.txt", "ab.txt", "acb.txt"],
	},
	{
		pattern: "*.txt",
		names: ["line\nbreak.txt", "line\rbreak.txt"],
		selected: ["line\nbreak.txt", "line\rbreak.txt"],
	},
])("selects filenames with the supported pattern syntax: $pattern", async ({ pattern, names, selected }) => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-syntax-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	for (const name of names) {
		fs.writeFileSync(path.join(sourcePath, name), "backup");
	}

	try {
		const selection = resolveBackupTargets(
			{ includePatterns: [pattern] },
			canonicalSourcePath,
			canonicalSourcePath,
			new AbortController().signal,
		);

		if (selected.length === 0) {
			await expect(selection).rejects.toThrow("No trusted backup target matches the include patterns");
		} else {
			await expect(selection).resolves.toEqual(selected.map((name) => path.join(canonicalSourcePath, name)));
		}
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test.skipIf(process.platform === "win32").each([
	{ pattern: "report\\?.txt", names: ["report?.txt", "report1.txt"], selected: "report?.txt" },
	{ pattern: "report\\*.txt", names: ["report*.txt", "report1.txt"], selected: "report*.txt" },
	{ pattern: "[\\-].txt", names: ["-.txt", "a.txt"], selected: "-.txt" },
	{ pattern: "[\\]].txt", names: ["].txt", "a.txt"], selected: "].txt" },
])("selects escaped wildcard and class characters: $pattern", async ({ pattern, names, selected }) => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-escapes-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	for (const name of names) {
		fs.writeFileSync(path.join(sourcePath, name), "backup");
	}

	try {
		await expect(
			resolveBackupTargets(
				{ includePatterns: [pattern] },
				canonicalSourcePath,
				canonicalSourcePath,
				new AbortController().signal,
			),
		).resolves.toEqual([path.join(canonicalSourcePath, selected)]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test.skipIf(process.platform === "win32").each(["report\\", "missing/report\\"])(
	"rejects an incomplete escape: %j",
	async (pattern) => {
		const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-incomplete-escape-"));
		const canonicalSourcePath = fs.realpathSync.native(sourcePath);

		try {
			await expect(
				resolveBackupTargets(
					{ includePatterns: [pattern] },
					canonicalSourcePath,
					canonicalSourcePath,
					new AbortController().signal,
				),
			).rejects.toThrow("Invalid include pattern");
		} finally {
			fs.rmSync(sourcePath, { recursive: true, force: true });
		}
	},
);

test.each(["[", "[]", "[^]", "[-a]", "[a-]", "[a-b", "missing/[", "missing*/[", "report[z-a]["])(
	"rejects malformed patterns even when directories or filenames do not match: %j",
	async (pattern) => {
		const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-invalid-"));
		const canonicalSourcePath = fs.realpathSync.native(sourcePath);
		fs.writeFileSync(path.join(sourcePath, "report.txt"), "backup");

		try {
			await expect(
				resolveBackupTargets(
					{ includePatterns: [pattern] },
					canonicalSourcePath,
					canonicalSourcePath,
					new AbortController().signal,
				),
			).rejects.toThrow("Invalid include pattern");
		} finally {
			fs.rmSync(sourcePath, { recursive: true, force: true });
		}
	},
);

test("treats double stars as a single directory level and sorts each level deterministically", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-double-star-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	fs.mkdirSync(path.join(sourcePath, "b", "nested"), { recursive: true });
	fs.mkdirSync(path.join(sourcePath, "a"));
	for (const name of ["root.txt", "b/nested/deep.txt", "b/z.txt", "b/a.txt", "a/report.txt"]) {
		fs.writeFileSync(path.join(sourcePath, name), "backup");
	}

	try {
		await expect(
			resolveBackupTargets(
				{ includePatterns: ["**/*.txt"] },
				canonicalSourcePath,
				canonicalSourcePath,
				new AbortController().signal,
			),
		).resolves.toEqual([
			path.join(canonicalSourcePath, "a", "report.txt"),
			path.join(canonicalSourcePath, "b", "a.txt"),
			path.join(canonicalSourcePath, "b", "z.txt"),
		]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("fails when trusted include patterns select no targets", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const signal = new AbortController().signal;

	try {
		await expect(
			resolveBackupTargets(
				{ includePatterns: ["missing*.txt"] },
				canonicalSourcePath,
				canonicalSourcePath,
				signal,
			),
		).rejects.toThrow("No trusted backup target matches the include patterns");
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("preserves leading spaces in trusted include patterns", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const leadingSpacePath = path.join(sourcePath, " leading.txt");
	const plainPath = path.join(sourcePath, "leading.txt");
	fs.writeFileSync(leadingSpacePath, "leading space");
	fs.writeFileSync(plainPath, "plain");
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const canonicalLeadingSpacePath = path.join(canonicalSourcePath, " leading.txt");
	const signal = new AbortController().signal;

	try {
		const selection = await resolveBackupTargets(
			{ includePatterns: [" leading.txt"] },
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection).toEqual([canonicalLeadingSpacePath]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("trims mixed Go whitespace in text patterns while preserving it in raw paths", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-whitespace-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const literalName = "plain.txt \u0085\u3000";
	fs.writeFileSync(path.join(sourcePath, "plain.txt"), "plain");
	fs.writeFileSync(path.join(sourcePath, literalName), "literal whitespace");

	try {
		await expect(
			resolveBackupTargets(
				{ includePaths: [literalName], includePatterns: [literalName] },
				canonicalSourcePath,
				canonicalSourcePath,
				new AbortController().signal,
			),
		).resolves.toEqual([path.join(canonicalSourcePath, literalName), path.join(canonicalSourcePath, "plain.txt")]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("handles long whitespace runs within the selection deadline", () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-deadline-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	fs.writeFileSync(path.join(sourcePath, "keep.txt"), "backup");

	try {
		const output = execFileSync(
			process.execPath,
			[
				"-e",
				`
			import { resolveBackupTargets } from ${JSON.stringify(path.resolve(import.meta.dirname, "../backup-selection.ts"))};
			const sourcePath = ${JSON.stringify(canonicalSourcePath)};
			const results = [];

			for (const whitespace of ["\\t", "\\u3000"]) {
				const run = whitespace.repeat(200_000);
				const targets = await resolveBackupTargets(
					{ includePaths: ["keep.txt"], includePatterns: ["!" + run + "x", "keep.txt" + run] },
					sourcePath,
					sourcePath,
					new AbortController().signal,
				);
				results.push(targets);
			}

			console.log(JSON.stringify(results));
		`,
			],
			{ encoding: "utf8", timeout: 5_000 },
		);

		const target = path.join(canonicalSourcePath, "keep.txt");
		expect(JSON.parse(output)).toEqual([
			[target, target],
			[target, target],
		]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
}, 10_000);

test.each(["\n", "\r"])(
	"keeps literal selected paths containing %j and final symlinks as raw targets",
	async (lineBreak) => {
		const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
		const sourcePath = path.join(rootPath, "allowed");
		const outsidePath = path.join(rootPath, "outside");
		const literalName = `reports [1]${lineBreak}2026`;
		const literalPath = path.join(sourcePath, literalName);
		const outsideMarkerPath = path.join(outsidePath, "marker.txt");
		const symlinkPath = path.join(sourcePath, "marker-link");
		fs.mkdirSync(sourcePath);
		fs.mkdirSync(outsidePath);
		fs.writeFileSync(literalPath, "trusted");
		fs.writeFileSync(outsideMarkerPath, "outside");
		fs.symlinkSync(outsideMarkerPath, symlinkPath, "file");
		const canonicalSourcePath = fs.realpathSync.native(sourcePath);
		const canonicalLiteralPath = path.join(canonicalSourcePath, literalName);
		const canonicalSymlinkPath = path.join(canonicalSourcePath, "marker-link");
		const signal = new AbortController().signal;

		try {
			const selection = await resolveBackupTargets(
				{ includePaths: [literalName, "marker-link"] },
				canonicalSourcePath,
				canonicalSourcePath,
				signal,
			);

			expect(selection).toEqual([canonicalLiteralPath, canonicalSymlinkPath]);
		} finally {
			fs.rmSync(rootPath, { recursive: true, force: true });
		}
	},
);

test("propagates cancellation from trusted selection", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const controller = new AbortController();
	const cancellation = new Error("selection cancelled");
	controller.abort(cancellation);

	try {
		await expect(
			resolveBackupTargets(
				{ includePatterns: ["*.txt"] },
				canonicalSourcePath,
				canonicalSourcePath,
				controller.signal,
			),
		).rejects.toBe(cancellation);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("yields to in-flight cancellation while matching a large directory", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	for (let index = 0; index < 128; index += 1) {
		const exportPath = path.join(sourcePath, `export-${index}.txt`);
		fs.writeFileSync(exportPath, "export");
	}
	const controller = new AbortController();
	const cancellation = new Error("selection cancelled");
	const selection = resolveBackupTargets(
		{ includePatterns: ["*.txt"] },
		canonicalSourcePath,
		canonicalSourcePath,
		controller.signal,
	);
	const cancellationScheduled = new Promise<void>((resolve) => {
		setTimeout(() => {
			controller.abort(cancellation);
			resolve();
		}, 0);
	});

	try {
		await cancellationScheduled;
		await expect(selection).rejects.toBe(cancellation);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

const goCommand = Bun.which("go");

test.skipIf(process.platform === "win32" || !goCommand)(
	"selects the same files as Restic's Go glob for generated patterns",
	async () => {
		const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-fuzz-"));
		const fragments = fc.constantFrom(
			{ pattern: "*", witness: "ab" },
			{ pattern: "**", witness: "" },
			{ pattern: "?", witness: "😀" },
			{ pattern: "*??", witness: "ab" },
			{ pattern: "*?*?", witness: "ab" },
			{ pattern: "[a-c]", witness: "b" },
			{ pattern: "[^a-c]", witness: "é" },
			{ pattern: "[!a]", witness: "!" },
			{ pattern: "[😀-🙏]", witness: "😁" },
			{ pattern: "[\\]]", witness: "]" },
			{ pattern: "[\\-]", witness: "-" },
			{ pattern: "\\*", witness: "*" },
			{ pattern: "\\?", witness: "?" },
			{ pattern: "a", witness: "a" },
			{ pattern: "é", witness: "é" },
			{ pattern: "😀", witness: "😀" },
			{ pattern: "�", witness: "�" },
			{ pattern: "[^�]", witness: "a" },
			{ pattern: ".", witness: "." },
			{ pattern: "{a,b}", witness: "{a,b}" },
			{ pattern: "(a|b)", witness: "(a|b)" },
		);
		const names = fc.uniqueArray(
			fc
				.array(fc.constantFrom("a", "b", "c", "d", "!", ".", "-", "é", "😀", "😁", "🙏", "�", "*", "?", "]"), {
					maxLength: 12,
				})
				.map((characters) => characters.join("")),
			{ maxLength: 8 },
		);

		try {
			const oracleCommand = path.join(rootPath, "glob");
			execFileSync(
				goCommand!,
				["build", "-o", oracleCommand, path.join(import.meta.dirname, "fixtures", "glob.go")],
				{
					env: {
						PATH: process.env.PATH,
						GOCACHE: path.join(rootPath, "go-cache"),
						GOPATH: path.join(rootPath, "go-path"),
						GOENV: "off",
						GOTOOLCHAIN: "local",
						GOPROXY: "off",
						CGO_ENABLED: "0",
					},
					timeout: 60_000,
				},
			);

			await fc.assert(
				fc.asyncProperty(
					fc.oneof(
						fc.array(fragments, { minLength: 1, maxLength: 8 }),
						fc.array(fc.constantFrom({ pattern: "*", witness: "ab" }, { pattern: "?", witness: "😀" }), {
							minLength: 1,
							maxLength: 8,
						}),
					),
					names,
					async (parts, candidates) => {
						const sourcePath = fs.mkdtempSync(path.join(rootPath, "case-"));
						const canonicalSourcePath = fs.realpathSync.native(sourcePath);
						const pattern = `file-${parts.map((part) => part.pattern).join("")}.txt`;
						const witness = parts.map((part) => part.witness).join("");
						const filenames = [
							...new Set(
								[...candidates, witness, "a", "ab", "é", "éé", "😀", "😀😀", "�"].map(
									(name) => `file-${name}.txt`,
								),
							),
						];
						for (const filename of filenames) {
							fs.writeFileSync(path.join(sourcePath, filename), "backup");
						}

						try {
							const expected: string[] = JSON.parse(
								execFileSync(oracleCommand, {
									input: JSON.stringify(path.join(canonicalSourcePath, pattern)),
									encoding: "utf8",
								}),
							);
							const selection = resolveBackupTargets(
								{ includePatterns: [pattern] },
								canonicalSourcePath,
								canonicalSourcePath,
								new AbortController().signal,
							);

							if (expected.length === 0) {
								await expect(selection).rejects.toThrow(
									"No trusted backup target matches the include patterns",
								);
							} else {
								await expect(selection).resolves.toEqual(expected);
							}
						} finally {
							fs.rmSync(sourcePath, { recursive: true, force: true });
						}
					},
				),
				{ numRuns: 300 },
			);
		} finally {
			fs.rmSync(rootPath, { recursive: true, force: true });
		}
	},
	60_000,
);

test.skipIf(process.platform === "win32")(
	"rejects generated malformed patterns regardless of matching prefixes",
	async () => {
		const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-selection-invalid-fuzz-"));
		const canonicalSourcePath = fs.realpathSync.native(sourcePath);
		fs.writeFileSync(path.join(sourcePath, "report.txt"), "backup");

		try {
			await fc.assert(
				fc.asyncProperty(
					fc.array(fc.constantFrom("a", "b", "*", "?", "[a-c]"), { maxLength: 8 }),
					fc.constantFrom("[", "[]", "[^]", "[-a]", "[a-]", "[a-b", "\\"),
					fc.boolean(),
					async (prefix, malformed, missingDirectory) => {
						const pattern = `${missingDirectory ? "missing/" : ""}${prefix.join("")}${malformed}`;

						await expect(
							resolveBackupTargets(
								{ includePatterns: [pattern] },
								canonicalSourcePath,
								canonicalSourcePath,
								new AbortController().signal,
							),
						).rejects.toThrow("Invalid include pattern");
					},
				),
				{ numRuns: 300 },
			);
		} finally {
			fs.rmSync(sourcePath, { recursive: true, force: true });
		}
	},
);
