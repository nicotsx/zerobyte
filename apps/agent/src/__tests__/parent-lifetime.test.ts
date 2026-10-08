import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
		throw error;
	}
};

test.each([false, true])(
	"local agent exits after its controller dies (watch: %s)",
	async (watch) => {
		let connections = 0;
		let ready = false;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request)) return;
				return new Response(null, { status: 400 });
			},
			websocket: {
				open() {
					connections++;
				},
				message(_socket, message) {
					if (JSON.parse(String(message)).type === "agent.ready") ready = true;
				},
			},
		});
		const entrypoint = path.resolve(import.meta.dirname, "../index.ts");
		const args = watch ? ["run", "--watch", entrypoint] : ["run", entrypoint];
		const parentSource = `
		import { spawn } from "node:child_process";
		const child = spawn(process.execPath, ${JSON.stringify(args)}, {
			env: { ...process.env, ZEROBYTE_BUILTIN_LOCAL_AGENT: "1" },
			detached: process.platform !== "win32",
			stdio: ["pipe", "ignore", "ignore"],
		});
		console.log(child.pid);
		setInterval(() => {}, 1000);
	`;
		const parent = spawn(process.execPath, ["-e", parentSource], {
			env: {
				...process.env,
				ZEROBYTE_CONTROLLER_URL: `ws://127.0.0.1:${server.port}/agents/connect`,
				ZEROBYTE_AGENT_TOKEN: "test-token",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let childPid: number | undefined;

		try {
			const [output] = await once(parent.stdout, "data");
			childPid = Number(String(output).trim());
			expect(Number.isSafeInteger(childPid)).toBe(true);
			await vi.waitFor(() => expect(ready).toBe(true), { timeout: 10_000 });
			expect(isAlive(childPid)).toBe(true);

			const exited = once(parent, "exit");
			parent.kill("SIGKILL");
			await exited;

			await vi.waitFor(() => expect(isAlive(childPid!)).toBe(false), { timeout: 7_000 });
			expect(connections).toBe(1);
		} finally {
			parent.kill("SIGKILL");
			if (childPid && isAlive(childPid)) {
				process.kill(process.platform === "win32" ? childPid : -childPid, "SIGKILL");
			}
			await server.stop(true);
		}
	},
	20_000,
);

test("standalone agent keeps running with closed stdin", async () => {
	let ready = false;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request, server) {
			if (server.upgrade(request)) return;
			return new Response(null, { status: 400 });
		},
		websocket: {
			message(_socket, message) {
				if (JSON.parse(String(message)).type === "agent.ready") ready = true;
			},
		},
	});
	const agent = spawn(process.execPath, ["run", path.resolve(import.meta.dirname, "../index.ts")], {
		env: {
			...process.env,
			ZEROBYTE_BUILTIN_LOCAL_AGENT: "0",
			ZEROBYTE_CONTROLLER_URL: `ws://127.0.0.1:${server.port}/agents/connect`,
			ZEROBYTE_AGENT_TOKEN: "test-token",
		},
		stdio: ["pipe", "ignore", "ignore"],
	});

	try {
		agent.stdin.end();
		await vi.waitFor(() => expect(ready).toBe(true), { timeout: 10_000 });
		await new Promise((resolve) => setTimeout(resolve, 1_100));
		expect(agent.exitCode).toBeNull();
		expect(agent.signalCode).toBeNull();
	} finally {
		const exited = once(agent, "exit");
		agent.kill("SIGKILL");
		await exited;
		await server.stop(true);
	}
}, 15_000);

test.skipIf(process.platform === "win32").each(["SIGINT", "SIGTERM"] as const)(
	"%s closes the controller connection and bounds shutdown despite a retained handle",
	async (signal) => {
		const directory = await mkdtemp(path.join(tmpdir(), "zerobyte-agent-shutdown-"));
		const preload = path.join(directory, "retained-handle.ts");
		await writeFile(preload, "setInterval(() => {}, 1000);");

		let ready = false;
		let disconnected = false;
		const server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(request, server) {
				if (server.upgrade(request)) return;
				return new Response(null, { status: 400 });
			},
			websocket: {
				message(_socket, message) {
					if (JSON.parse(String(message)).type === "agent.ready") ready = true;
				},
				close() {
					disconnected = true;
				},
			},
		});
		const agent = spawn(
			process.execPath,
			["run", "--preload", preload, path.resolve(import.meta.dirname, "../index.ts")],
			{
				env: {
					...process.env,
					ZEROBYTE_BUILTIN_LOCAL_AGENT: "0",
					ZEROBYTE_CONTROLLER_URL: `ws://127.0.0.1:${server.port}/agents/connect`,
					ZEROBYTE_AGENT_TOKEN: "test-token",
				},
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		let stderr = "";
		agent.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		try {
			await vi.waitFor(
				() => {
					expect(agent.exitCode, stderr).toBeNull();
					expect(ready, stderr).toBe(true);
				},
				{ timeout: 10_000 },
			);
			const exited = once(agent, "exit");
			const startedAt = Date.now();
			agent.kill(signal);

			await vi.waitFor(() => expect(disconnected).toBe(true), { timeout: 1_000 });
			expect(agent.exitCode).toBeNull();
			await vi.waitFor(() => expect(agent.exitCode).toBe(0), { timeout: 6_000 });
			await exited;
			expect(Date.now() - startedAt).toBeLessThan(6_000);
		} finally {
			if (agent.exitCode === null && agent.signalCode === null) {
				const exited = once(agent, "exit");
				agent.kill("SIGKILL");
				await exited;
			}
			await server.stop(true);
			await rm(directory, { recursive: true, force: true });
		}
	},
	20_000,
);
