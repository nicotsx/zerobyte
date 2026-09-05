import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, test } from "vitest";
import { resolveTrustedBackupSelection } from "../trusted-backup-selection";

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
		const selection = await resolveTrustedBackupSelection(
			{ includePatterns: [path.join(canonicalSourcePath, "*.txt")] },
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection.includePaths).toEqual([canonicalSourceMarkerPath]);
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
				resolveTrustedBackupSelection(
					{ includePatterns: [pattern] },
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
		const selection = await resolveTrustedBackupSelection(
			{
				includePatterns: [
					path.join(canonicalSourcePath, "report[12].txt"),
					path.join(canonicalSourcePath, "report\\[1\\].txt"),
				],
			},
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection.includePaths).toEqual([
			path.join(canonicalSourcePath, "report1.txt"),
			path.join(canonicalSourcePath, "report2.txt"),
			path.join(canonicalSourcePath, "report[1].txt"),
		]);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("fails when trusted include patterns select no targets", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const signal = new AbortController().signal;

	try {
		await expect(
			resolveTrustedBackupSelection(
				{ includePatterns: [path.join(canonicalSourcePath, "missing*.txt")] },
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
		const selection = await resolveTrustedBackupSelection(
			{ includePatterns: [canonicalLeadingSpacePath] },
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection.includePaths).toEqual([canonicalLeadingSpacePath]);
	} finally {
		fs.rmSync(sourcePath, { recursive: true, force: true });
	}
});

test("keeps literal selected paths and final symlinks as raw targets", async () => {
	const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const sourcePath = path.join(rootPath, "allowed");
	const outsidePath = path.join(rootPath, "outside");
	const literalPath = path.join(sourcePath, "reports [1]\n2026");
	const outsideMarkerPath = path.join(outsidePath, "marker.txt");
	const symlinkPath = path.join(sourcePath, "marker-link");
	fs.mkdirSync(sourcePath);
	fs.mkdirSync(outsidePath);
	fs.writeFileSync(literalPath, "trusted");
	fs.writeFileSync(outsideMarkerPath, "outside");
	fs.symlinkSync(outsideMarkerPath, symlinkPath, "file");
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const canonicalLiteralPath = path.join(canonicalSourcePath, "reports [1]\n2026");
	const canonicalSymlinkPath = path.join(canonicalSourcePath, "marker-link");
	const signal = new AbortController().signal;

	try {
		const selection = await resolveTrustedBackupSelection(
			{ includePaths: [canonicalLiteralPath, canonicalSymlinkPath] },
			canonicalSourcePath,
			canonicalSourcePath,
			signal,
		);

		expect(selection.includePaths).toEqual([canonicalLiteralPath, canonicalSymlinkPath]);
	} finally {
		fs.rmSync(rootPath, { recursive: true, force: true });
	}
});

test("propagates cancellation from trusted selection", async () => {
	const sourcePath = fs.mkdtempSync(path.join(os.tmpdir(), "zerobyte-trusted-selection-"));
	const canonicalSourcePath = fs.realpathSync.native(sourcePath);
	const controller = new AbortController();
	const cancellation = new Error("selection cancelled");
	controller.abort(cancellation);

	try {
		await expect(
			resolveTrustedBackupSelection(
				{ includePatterns: [path.join(canonicalSourcePath, "*.txt")] },
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
	const selection = resolveTrustedBackupSelection(
		{ includePatterns: [path.join(canonicalSourcePath, "*.txt")] },
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
