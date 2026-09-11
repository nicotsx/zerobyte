import { afterEach, expect, test, vi } from "vitest";
import { withTimeout } from "../timeout";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.resetModules();
});

test.each(["0", "1", "255"])(
	"rclone operations can complete after two seconds with SERVER_IDLE_TIMEOUT=%s",
	async (serverIdleTimeout) => {
		vi.stubEnv("SERVER_IDLE_TIMEOUT", serverIdleTimeout);
		vi.resetModules();
		const { RCLONE_TIMEOUT } = await import("../constants");
		vi.useFakeTimers();
		const operation = new Promise<string>((resolve) => setTimeout(() => resolve("mounted"), 2000));
		const assertion = expect(withTimeout(operation, RCLONE_TIMEOUT, "Rclone mount")).resolves.toBe("mounted");
		await Promise.all([assertion, vi.advanceTimersByTimeAsync(2000)]);
	},
);

test.each(["0", "1", "255"])(
	"rclone operations still time out after one minute with SERVER_IDLE_TIMEOUT=%s",
	async (serverIdleTimeout) => {
		vi.stubEnv("SERVER_IDLE_TIMEOUT", serverIdleTimeout);
		vi.resetModules();
		const { RCLONE_TIMEOUT } = await import("../constants");
		vi.useFakeTimers();
		const operation = new Promise<string>((resolve) => setTimeout(() => resolve("mounted"), 61_000));
		const assertion = expect(withTimeout(operation, RCLONE_TIMEOUT, "Rclone mount")).rejects.toMatchObject({
			code: "ETIMEOUT",
			message: "Rclone mount timed out after 60000ms",
		});
		await Promise.all([assertion, vi.advanceTimersByTimeAsync(61_000)]);
	},
);
