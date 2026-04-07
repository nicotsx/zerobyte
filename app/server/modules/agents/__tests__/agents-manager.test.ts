import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, expect, mock, test, vi } from "bun:test";

const spawnMock = mock();

await mock.module("node:child_process", () => ({
	...childProcess,
	spawn: spawnMock,
}));

import { spawnLocalAgent, stopLocalAgent } from "../agents-manager";

const flushMicrotasks = async () => {
	await Promise.resolve();
};

type FakeChildProcess = EventEmitter & {
	stdout: PassThrough;
	stderr: PassThrough;
	exitCode: number | null;
	signalCode: NodeJS.Signals | null;
	kill: ReturnType<typeof mock>;
};

const createFakeChild = () => {
	const child = new EventEmitter() as FakeChildProcess;

	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.exitCode = null;
	child.signalCode = null;
	child.kill = mock(() => {
		child.exitCode = 0;
		child.emit("exit", 0, null);
		return true;
	});

	return child;
};

afterEach(async () => {
	await stopLocalAgent();
	spawnMock.mockReset();
	mock.restore();
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

	vi.advanceTimersByTime(1_000);
	await flushMicrotasks();

	expect(spawnMock).toHaveBeenCalledTimes(2);
});

test("does not respawn the local agent after an intentional stop", async () => {
	vi.useFakeTimers();

	const child = createFakeChild();
	spawnMock.mockReturnValue(child);

	await spawnLocalAgent();
	await stopLocalAgent();

	vi.advanceTimersByTime(1_000);
	await flushMicrotasks();

	expect(spawnMock).toHaveBeenCalledTimes(1);
	expect(child.kill).toHaveBeenCalledTimes(1);
});
