import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { Effect } from "effect";
import { stopLocalAgentProcess } from "../local/process";

test.skipIf(process.platform === "win32").each(["graceful", "forced", "already-exited"])(
	"stops local worker descendants during %s shutdown",
	async (mode) => {
		const directory = await mkdtemp(path.join(tmpdir(), "zerobyte-agent-stop-"));
		const marker = path.join(directory, "activity");
		const childSource = `
			import { writeFileSync } from 'node:fs';
			process.on('SIGTERM', () => {});
			setInterval(() => writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 10);
			setTimeout(() => console.log('ready'), 50);
		`;
		const workerSource = `
			import { spawn } from 'node:child_process';
			${mode === "forced" ? "process.on('SIGTERM', () => {});" : ""}
			const child = spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], {
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			child.stdout.on('data', () => console.log('ready'));
			setInterval(() => {}, 1000);
		`;
		const worker = spawn(process.execPath, ["-e", workerSource], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		try {
			await once(worker.stdout, "data");
			expect(await readFile(marker, "utf8")).not.toBe("");

			if (mode === "already-exited") {
				worker.kill("SIGKILL");
				await once(worker, "exit");
			}

			await Effect.runPromise(stopLocalAgentProcess(worker));

			const lastActivity = await readFile(marker, "utf8");
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(await readFile(marker, "utf8")).toBe(lastActivity);
			expect(worker.exitCode !== null || worker.signalCode !== null).toBe(true);
		} finally {
			await Effect.runPromise(stopLocalAgentProcess(worker));
			await rm(directory, { recursive: true, force: true });
		}
	},
	15_000,
);
