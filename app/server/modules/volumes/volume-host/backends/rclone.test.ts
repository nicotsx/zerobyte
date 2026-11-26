import type { Dir } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();

	return {
		...actual,
		opendir: vi.fn(actual.opendir),
	};
});

vi.mock("./utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./utils")>();

	return {
		...actual,
		assertMounted: vi.fn(),
	};
});

import * as fs from "node:fs/promises";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { makeRcloneBackend } from "./rclone";
import { assertMounted } from "./utils";

const config: BackendConfig = { backend: "rclone", remote: "remote", path: "/" };

const fakeDir = (read: () => Promise<unknown>) =>
	({ read, close: vi.fn().mockResolvedValue(undefined) }) as unknown as Dir;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("rclone checkHealth", () => {
	test("reports mounted when the mount point can be listed", async () => {
		vi.mocked(assertMounted).mockResolvedValueOnce(undefined);
		vi.mocked(fs.opendir).mockResolvedValueOnce(fakeDir(async () => null));

		await expect(makeRcloneBackend(config, "/tmp/volume").checkHealth()).resolves.toEqual({
			status: "mounted",
		});
	});

	test("reports an error when listing the mount point fails", async () => {
		vi.mocked(assertMounted).mockResolvedValueOnce(undefined);
		vi.mocked(fs.opendir).mockResolvedValueOnce(
			fakeDir(async () => {
				throw Object.assign(new Error("EIO: i/o error, scandir '/tmp/volume'"), {
					code: "EIO",
				});
			}),
		);

		await expect(makeRcloneBackend(config, "/tmp/volume").checkHealth()).resolves.toEqual({
			status: "error",
			error: "EIO: i/o error, scandir '/tmp/volume'",
		});
	});
});
