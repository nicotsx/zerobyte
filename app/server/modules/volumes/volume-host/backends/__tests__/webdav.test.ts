import type { BackendConfig } from "@zerobyte/contracts/volumes";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn().mockResolvedValue(undefined), rmdir: vi.fn() }));

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();

	return { ...actual, platform: () => "linux" };
});

vi.mock("../utils", () => ({
	assertMounted: vi.fn().mockRejectedValue(new Error("Volume is not mounted")),
	executeDavfsMount: vi.fn().mockResolvedValue(undefined),
	executeUnmount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../fs", () => ({ getMountForPath: vi.fn().mockResolvedValue(undefined) }));

import { makeWebdavBackend } from "../webdav";
import { executeDavfsMount } from "../utils";

const baseConfig: BackendConfig = {
	backend: "webdav",
	server: "webdav.example.com",
	path: "/backups",
	port: 443,
	ssl: true,
	readOnly: true,
};

afterEach(() => vi.clearAllMocks());

test("passes WebDAV credentials through stdin and bypasses shared davfs secrets", async () => {
	const backend = makeWebdavBackend(
		{ ...baseConfig, username: "archive-user", password: "private password" },
		"/tmp/zerobyte-webdav",
	);

	await expect(backend.mount()).resolves.toEqual({ status: "mounted" });

	expect(executeDavfsMount).toHaveBeenCalledOnce();
	const [args, password] = vi.mocked(executeDavfsMount).mock.calls[0]!;
	expect(args[args.indexOf("-o") + 1]?.split(",")).toEqual(
		expect.arrayContaining(["file_mode=0444", "dir_mode=0555", "ro", "username=archive-user"]),
	);
	expect(args).not.toContain("private password");
	expect(args).not.toContain("-t");
	expect(password).toBe("private password");
});

test("prevents credentialless mounts from reusing a stale shared secret", async () => {
	const backend = makeWebdavBackend(baseConfig, "/tmp/zerobyte-webdav");

	await expect(backend.mount()).resolves.toEqual({ status: "mounted" });

	const [args, password] = vi.mocked(executeDavfsMount).mock.calls[0]!;
	expect(args[args.indexOf("-o") + 1]?.split(",")).toContain("username=zerobyte-anonymous");
	expect(password).toBe("");
});

test("rejects credentials that could alter mount options or stdin framing", async () => {
	const usernameBackend = makeWebdavBackend({ ...baseConfig, username: "user,conf=/tmp/other" }, "/tmp/webdav");
	const passwordBackend = makeWebdavBackend({ ...baseConfig, password: "first\nsecond" }, "/tmp/webdav");

	await expect(usernameBackend.mount()).resolves.toMatchObject({ status: "error" });
	await expect(passwordBackend.mount()).resolves.toMatchObject({ status: "error" });
	expect(executeDavfsMount).not.toHaveBeenCalled();
});
