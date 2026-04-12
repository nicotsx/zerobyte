import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", async () => {
	return { spawn: spawnMock };
});

const { spawnLocalAgent, stopLocalAgent } = await import("../agents-manager");

type FakeChildProcess = EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	kill: ReturnType<typeof vi.fn>;
};

const createFakeChild = () => {
	const child = new EventEmitter() as FakeChildProcess;

	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.exitCode = null;
	child.signalCode = null;
	child.kill = vi.fn(() => {
		child.exitCode = 0;
		child.emit("exit", 0, null);
		return true;
	});

	return child;
};

afterEach(async () => {
	await stopLocalAgent();
	spawnMock.mockReset();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("respawns the local agent after an unexpected exit", async () => {
	vi.useFakeTimers();

	const firstChild = createFakeChild();
	const secondChild = createFakeChild();
	spawnMock.mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild);

	await spawnLocalAgent();

	firstChild.exitCode = 1;
	firstChild.emit("exit", 1, null);

	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledTimes(2);
});

test("does not respawn the local agent after an intentional stop", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await spawnLocalAgent();
	await stopLocalAgent();

	await vi.advanceTimersByTimeAsync(1_000);

	expect(spawnMock).toHaveBeenCalledTimes(1);
	expect(child.kill).toHaveBeenCalledTimes(1);
});
