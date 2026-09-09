import { afterEach, expect, test, vi } from "vitest";
import { checkRestic } from "./prerequisites";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@zerobyte/core/node", () => ({ safeExec: execute, resolveResticHostname: vi.fn() }));
afterEach(() => {
	vi.unstubAllEnvs();
	execute.mockReset();
});

test.each(["0.18.0", "0.19.1", "1.0.0"])("accepts supported stable Restic %s", async (version) => {
	execute.mockResolvedValue({ exitCode: 0, stdout: `restic ${version} compiled with go1.24.0 on linux/amd64` });
	vi.stubEnv("RESTIC_COMMAND", ' "/opt/restic" ');
	await expect(checkRestic()).resolves.toBe(version);
	expect(execute).toHaveBeenCalledWith({
		command: "/opt/restic",
		args: ["version"],
		timeout: 10_000,
		maxBuffer: 16_384,
	});
});

test.each(["0.9.6", "0.17.3"])("rejects outdated Restic %s", async (version) => {
	execute.mockResolvedValue({ exitCode: 0, stdout: `restic ${version} compiled with go1.23.0` });
	await expect(checkRestic()).rejects.toThrow("Upgrade to Restic 0.18.0 or newer");
});

test.each(["restic 0.18.0-dev", "unexpected output"])("rejects unsupported version output: %s", async (stdout) => {
	execute.mockResolvedValue({ exitCode: 0, stdout });
	await expect(checkRestic()).rejects.toThrow("Unrecognized Restic version");
});

test("an unavailable or failing Restic gives an actionable startup error", async () => {
	execute.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "spawn restic ENOENT" });
	await expect(checkRestic()).rejects.toThrow("Install Restic 0.18.0 or newer on PATH");
});
