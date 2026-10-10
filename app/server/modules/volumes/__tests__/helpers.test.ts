import type * as path from "node:path";
import { expect, test, vi } from "vitest";
import { getLocalFilesystemSource } from "../helpers";

vi.mock("node:path", async (original) => {
	const actual = await original<typeof path>();

	return { ...actual, ...actual.win32, default: actual.win32 };
});

test.each([
	["C:\\Users\\photos", "local-filesystem-c", "Users/photos"],
	["D:\\Backups\\archive", "local-filesystem-d", "Backups/archive"],
	["d:/Backups/archive", "local-filesystem-d", "Backups/archive"],
	["D:\\", "local-filesystem-d", ""],
])("resolves Windows path %s relative to its own drive", (localPath, rootId, relativePath) => {
	expect(getLocalFilesystemSource(localPath)).toEqual({ rootId, relativePath });
});
