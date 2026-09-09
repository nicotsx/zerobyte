import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { controlService, showLogs } from "../service-commands";

vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
	spawn: vi.fn(),
}));
const platform = process.platform;
afterEach(() => {
	Object.defineProperty(process, "platform", { value: platform });
	vi.restoreAllMocks();
	vi.clearAllMocks();
});
const childProcess = () => {
	Object.defineProperty(process, "platform", { value: "linux" });
	const child = new EventEmitter();
	vi.mocked(spawn).mockReturnValue(child as ReturnType<typeof spawn>);
	return child;
};
test("logs print the last 30 lines and return when journalctl exits", async () => {
	const child = childProcess();
	const operation = showLogs({ lines: 30 });
	expect(spawn).toHaveBeenCalledWith(
		"journalctl",
		["--unit=zerobyte-agent", "--no-pager", "--output=cat", "--lines=30"],
		expect.objectContaining({ stdio: "inherit" }),
	);
	child.emit("exit", 0, null);
	await operation;
});
test("following logs can end with Ctrl+C without stopping the agent", async () => {
	const child = childProcess();
	const operation = showLogs({ lines: 50, follow: true });
	expect(spawn).toHaveBeenCalledTimes(1);
	expect(vi.mocked(spawn).mock.calls[0]?.[1]).toContain("--follow");
	child.emit("exit", null, "SIGINT");
	await expect(operation).resolves.toBeUndefined();
	expect(spawn).not.toHaveBeenCalledWith("systemctl", expect.anything(), expect.anything());
});
test("start uses the background service and returns after systemctl", async () => {
	const child = childProcess();
	const operation = controlService("start");
	expect(spawn).toHaveBeenCalledWith(
		"systemctl",
		["start", "zerobyte-agent.service", "--no-pager"],
		expect.objectContaining({ stdio: "inherit" }),
	);
	child.emit("exit", 0, null);
	await operation;
});
