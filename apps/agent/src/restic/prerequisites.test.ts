import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import { commandFailure, createTestHost, runTest } from "../__tests__/effect-test-support";
import { checkRestic } from "./prerequisites";

afterEach(() => {
	vi.unstubAllEnvs();
});

test.each(["0.18.0", "0.19.1", "1.0.0"])("accepts supported stable Restic %s", async (version) => {
	const host = createTestHost(version);
	vi.stubEnv("RESTIC_COMMAND", ' "/opt/restic" ');

	await expect(runTest(checkRestic, host)).resolves.toBe(version);
	expect(host.output).toHaveBeenCalledWith("/opt/restic", ["version"]);
});

test.each(["0.9.6", "0.17.3"])("rejects outdated Restic %s", async (version) => {
	await expect(runTest(checkRestic, createTestHost(version))).rejects.toThrow("Upgrade to Restic 0.18.0 or newer");
});

test.each(["restic 0.18.0-dev", "unexpected output"])("rejects unsupported version output: %s", async (output) => {
	const host = createTestHost();
	host.output.mockReturnValue(Effect.succeed(output));

	await expect(runTest(checkRestic, host)).rejects.toThrow("Unrecognized Restic version");
});

test("an unavailable or failing Restic gives an actionable startup error", async () => {
	const host = createTestHost();
	host.output.mockReturnValue(commandFailure("spawn restic ENOENT"));

	await expect(runTest(checkRestic, host)).rejects.toThrow("Install Restic 0.18.0 or newer on PATH");
});
