import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FILE_MODES, writeFileWithMode } from "../fs";

const tempDirectories = new Set<string>();

afterEach(async () => {
	await Promise.all(
		[...tempDirectories].map(async (directoryPath) => {
			await fs.rm(directoryPath, { recursive: true, force: true });
		}),
	);
	tempDirectories.clear();
});

describe("writeFileWithMode", () => {
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
