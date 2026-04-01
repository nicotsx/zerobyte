import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();

	return {
		...actual,
		access: vi.fn(actual.access),
	};
});

vi.mock("../../../../utils/mountinfo", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../../utils/mountinfo")>();

	return {
		...actual,
		getMountForPath: vi.fn(actual.getMountForPath),
	};
});

import * as fs from "node:fs/promises";
import * as mountinfo from "../../../../utils/mountinfo";
import { assertMounted } from "../backend-utils";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("assertMountedFilesystem", () => {
	test("throws when the path is not accessible", async () => {
		vi.mocked(fs.access).mockRejectedValueOnce(new Error("missing"));

		await expect(assertMounted("/tmp/volume", (fstype) => fstype.startsWith("nfs"))).rejects.toThrow(
			"Volume is not mounted",
		);
	});

	test("throws when the mount filesystem does not match", async () => {
		vi.mocked(fs.access).mockResolvedValueOnce(undefined);
		vi.mocked(mountinfo.getMountForPath).mockResolvedValueOnce({
			mountPoint: "/tmp/volume",
			fstype: "cifs",
		});

		await expect(assertMounted("/tmp/volume", (fstype) => fstype.startsWith("nfs"))).rejects.toThrow(
			"Path /tmp/volume is not mounted as correct fstype (found cifs).",
		);
	});

	test("accepts a matching mounted filesystem", async () => {
		vi.mocked(fs.access).mockResolvedValueOnce(undefined);
		vi.mocked(mountinfo.getMountForPath).mockResolvedValueOnce({
			mountPoint: "/tmp/volume",
			fstype: "nfs4",
		});

		await expect(assertMounted("/tmp/volume", (fstype) => fstype.startsWith("nfs"))).resolves.toBeUndefined();
	});
});
