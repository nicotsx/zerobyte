import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	existsSync: vi.fn(),
	setPriority: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock("node:fs", async (importActual) => {
	const actual = await importActual<typeof import("node:fs")>();
	return { ...actual, existsSync: mocks.existsSync };
});

vi.mock("node:os", async (importActual) => {
	const actual = await importActual<typeof import("node:os")>();
	return { ...actual, setPriority: mocks.setPriority };
});

vi.mock("node:child_process", async (importActual) => {
	const actual = await importActual<typeof import("node:child_process")>();
	return { ...actual, spawn: mocks.spawn };
});

const { safeSpawn } = await import("../spawn");

const createChildProcess = () => {
	const child = new EventEmitter() as EventEmitter & {
		pid: number;
		stdout: PassThrough;
		stderr: PassThrough;
	};

	child.pid = 1234;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();

	return child;
};

describe("safeSpawn background priority", () => {
	beforeEach(() => {
		mocks.existsSync.mockReset();
		mocks.setPriority.mockReset();
		mocks.spawn.mockReset();
		mocks.spawn.mockImplementation(() => {
			const child = createChildProcess();

			queueMicrotask(() => {
				child.stdout.end();
				child.stderr.end();
				child.emit("close", 0);
			});

			return child;
		});
	});

	test("runs background commands through best-effort ionice when available", async () => {
		mocks.existsSync.mockImplementation((path: string) => path === "/bin/ionice");

		await safeSpawn({ command: "restic", args: ["backup", "/data"], priority: "background" });

		expect(mocks.spawn).toHaveBeenCalledWith(
			"/bin/ionice",
			["-t", "-c", "3", "restic", "backup", "/data"],
			expect.objectContaining({ shell: false, stdio: ["ignore", "pipe", "pipe"] }),
		);
		expect(mocks.setPriority).toHaveBeenCalledWith(1234, 10);
	});

	test("runs background commands directly when ionice is unavailable", async () => {
		mocks.existsSync.mockReturnValue(false);

		await safeSpawn({ command: "restic", args: ["backup", "/data"], priority: "background" });

		expect(mocks.spawn).toHaveBeenCalledWith(
			"restic",
			["backup", "/data"],
			expect.objectContaining({ shell: false, stdio: ["ignore", "pipe", "pipe"] }),
		);
		expect(mocks.setPriority).toHaveBeenCalledWith(1234, 10);
	});
});
