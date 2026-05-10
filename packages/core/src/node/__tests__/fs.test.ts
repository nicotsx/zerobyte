import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FILE_MODES, ensureFileMode, writeFileWithMode } from "../fs";

const tempDirectories = new Set<string>();

afterEach(async () => {
	await Promise.all(
		[...tempDirectories].map(async (directoryPath) => {
			await fs.rm(directoryPath, { recursive: true, force: true });
		}),
	);
	tempDirectories.clear();
});

describe("ensureFileMode", () => {
	test("returns false and leaves the file unchanged when mode is already correct", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-ensure-file-mode-"));
		tempDirectories.add(tempDirectory);

		const filePath = path.join(tempDirectory, "identity");
		await fs.writeFile(filePath, "content");
		await fs.chmod(filePath, 0o600);

		const fixed = await ensureFileMode(filePath, FILE_MODES.ownerReadWrite);

		expect(fixed).toBe(false);
		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
	});

	test("returns true and applies the correct mode when permissions are wrong", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-ensure-file-mode-"));
		tempDirectories.add(tempDirectory);

		const filePath = path.join(tempDirectory, "identity");
		await fs.writeFile(filePath, "content");
		await fs.chmod(filePath, 0o755);

		const fixed = await ensureFileMode(filePath, FILE_MODES.ownerReadWrite);

		expect(fixed).toBe(true);
		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
	});

	test("returns false when the file does not exist", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-ensure-file-mode-"));
		tempDirectories.add(tempDirectory);

		const fixed = await ensureFileMode(path.join(tempDirectory, "nonexistent.key"), FILE_MODES.ownerReadWrite);
		expect(fixed).toBe(false);
	});
});

describe("writeFileWithMode", () => {
	test("applies the requested mode when creating a new file", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-write-file-with-mode-"));
		tempDirectories.add(tempDirectory);

		const filePath = path.join(tempDirectory, "identity");

		await writeFileWithMode(filePath, "content", FILE_MODES.ownerReadWrite);

		expect(await fs.readFile(filePath, "utf8")).toBe("content");
		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
	});

	test("applies the requested mode even when rewriting an existing file", async () => {
		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zerobyte-write-file-with-mode-"));
		tempDirectories.add(tempDirectory);

		const filePath = path.join(tempDirectory, "identity");
		await fs.writeFile(filePath, "old-content");
		await fs.chmod(filePath, 0o755);

		await writeFileWithMode(filePath, "new-content", FILE_MODES.ownerReadWrite);

		expect(await fs.readFile(filePath, "utf8")).toBe("new-content");
		expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
	});
});
