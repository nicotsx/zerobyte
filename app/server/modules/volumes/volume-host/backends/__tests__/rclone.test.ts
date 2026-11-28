import type { Dir } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { fromPartial } from "@total-typescript/shoehorn";
import type { BackendConfig } from "@zerobyte/contracts/volumes";
import * as nodeRuntime from "@zerobyte/core/node";
import { afterEach, expect, test, vi } from "vitest";
import { OPERATION_TIMEOUT } from "../../constants";
import { makeRcloneBackend } from "../rclone";

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()) }));
vi.mock("node:os", async (original) => ({ ...(await original<typeof os>()) }));
vi.mock("@zerobyte/core/node", async (original) => ({ ...(await original<typeof nodeRuntime>()) }));

const config: BackendConfig = { backend: "rclone", remote: "remote", path: "/" };
const mountPath = "/tmp/volume";
const mountInfo = `36 25 0:32 / ${mountPath} rw - fuse.rclone remote:/ rw`;
const listingError = Object.assign(new Error(`EIO: i/o error, scandir '${mountPath}'`), { code: "EIO" });

const makeDirectory = () => {
	const read = vi.fn<() => Promise<null>>().mockResolvedValue(null);
	const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
	const dir = fromPartial<Dir>({ read, close });
	return { dir, read, close };
};

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

test("reports an empty readable mount as mounted", async () => {
	vi.spyOn(fs, "access").mockResolvedValue();
	vi.spyOn(fs, "readFile").mockResolvedValue(mountInfo);
	const { dir, close } = makeDirectory();
	vi.spyOn(fs, "opendir").mockResolvedValue(dir);

	await expect(makeRcloneBackend(config, mountPath).checkHealth()).resolves.toEqual({ status: "mounted" });
	expect(close).toHaveBeenCalledOnce();
});

test("reports a failed listing and closes the directory handle", async () => {
	vi.spyOn(fs, "access").mockResolvedValue();
	vi.spyOn(fs, "readFile").mockResolvedValue(mountInfo);
	const { dir, read, close } = makeDirectory();
	read.mockRejectedValue(listingError);
	vi.spyOn(fs, "opendir").mockResolvedValue(dir);

	await expect(makeRcloneBackend(config, mountPath).checkHealth()).resolves.toEqual({
		status: "error",
		error: listingError.message,
	});
	expect(close).toHaveBeenCalledOnce();
});

test.each(["mounted", "error"] as const)("reports %s after probing a replacement mount", async (status) => {
	vi.spyOn(os, "platform").mockReturnValue("linux");
	vi.spyOn(fs, "access").mockResolvedValue();
	vi.spyOn(fs, "readFile").mockResolvedValue(mountInfo);
	vi.spyOn(fs, "mkdir").mockResolvedValue(undefined);
	vi.spyOn(fs, "rmdir").mockResolvedValue();
	const execute = vi.spyOn(nodeRuntime, "safeExec").mockResolvedValue({
		exitCode: 0,
		stdout: "",
		stderr: "",
		timedOut: false,
	});
	const existing = makeDirectory();
	existing.read.mockRejectedValue(listingError);
	const replacement = makeDirectory();
	if (status === "error") replacement.read.mockRejectedValue(listingError);
	vi.spyOn(fs, "opendir").mockResolvedValueOnce(existing.dir).mockResolvedValueOnce(replacement.dir);

	const result = await makeRcloneBackend(config, mountPath).mount();

	expect(result).toEqual(status === "mounted" ? { status } : { status, error: listingError.message });
	expect(execute.mock.calls.map(([request]) => request.command)).toEqual(["umount", "rclone"]);
	expect(replacement.close).toHaveBeenCalledOnce();
});

test("keeps one probe per mount through a timeout and until its handle closes", async () => {
	vi.useFakeTimers();
	vi.spyOn(os, "platform").mockReturnValue("linux");
	vi.spyOn(fs, "access").mockResolvedValue();
	const otherMountPath = "/tmp/other-volume";
	vi.spyOn(fs, "readFile").mockResolvedValue(
		`${mountInfo}\n37 25 0:33 / ${otherMountPath} rw - fuse.rclone remote:/ rw`,
	);
	const execute = vi.spyOn(nodeRuntime, "safeExec");
	const listing = Promise.withResolvers<null>();
	const closing = Promise.withResolvers<void>();
	const { dir, read, close } = makeDirectory();
	read.mockReturnValue(listing.promise);
	close.mockReturnValue(closing.promise);
	const open = vi.spyOn(fs, "opendir").mockResolvedValueOnce(dir).mockResolvedValue(makeDirectory().dir);

	const result = makeRcloneBackend(config, mountPath).mount();
	const anotherBackend = makeRcloneBackend(config, mountPath);
	const concurrentCheck = anotherBackend.checkHealth();
	await vi.advanceTimersByTimeAsync(0);

	const pending = { status: "error", error: "Rclone health check already in progress", inconclusive: true };
	expect(open).toHaveBeenCalledOnce();
	await expect(concurrentCheck).resolves.toEqual(pending);

	await vi.advanceTimersByTimeAsync(OPERATION_TIMEOUT);
	await expect(result).resolves.toEqual({
		status: "error",
		error: `Rclone health check timed out after ${OPERATION_TIMEOUT}ms`,
		inconclusive: true,
	});
	await expect(anotherBackend.checkHealth()).resolves.toEqual(pending);
	await expect(makeRcloneBackend(config, otherMountPath).checkHealth()).resolves.toEqual({ status: "mounted" });
	expect(execute).not.toHaveBeenCalled();
	expect(close).not.toHaveBeenCalled();

	listing.reject(listingError);
	await vi.advanceTimersByTimeAsync(0);
	expect(close).toHaveBeenCalledOnce();
	await expect(anotherBackend.checkHealth()).resolves.toEqual(pending);
	expect(open.mock.calls.map(([path]) => path)).toEqual([mountPath, otherMountPath]);

	closing.resolve();
	await vi.advanceTimersByTimeAsync(0);
	await expect(anotherBackend.checkHealth()).resolves.toEqual({ status: "mounted" });
	expect(open).toHaveBeenLastCalledWith(mountPath);
	expect(open).toHaveBeenCalledTimes(3);
});
