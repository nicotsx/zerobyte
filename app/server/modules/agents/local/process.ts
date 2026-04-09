import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "@zerobyte/core/node";
import { config } from "../../../core/config";
import { deriveLocalAgentToken } from "../helpers/tokens";

type LocalAgentState = {
	localAgent: ChildProcess | null;
};

export async function spawnLocalAgentProcess(runtime: LocalAgentState) {
	await stopLocalAgentProcess(runtime);

	const sourceEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
	const productionEntryPoint = path.join(process.cwd(), ".output", "agent", "index.mjs");

	if (config.__prod__ && !existsSync(productionEntryPoint)) {
		throw new Error(`Local agent entrypoint not found at ${productionEntryPoint}`);
	}

	const agentEntryPoint = config.__prod__ ? productionEntryPoint : sourceEntryPoint;
	const agentToken = await deriveLocalAgentToken();
	const args = config.__prod__ ? ["run", agentEntryPoint] : ["run", "--watch", agentEntryPoint];
	const agentProcess = spawn("bun", args, {
		env: {
			PATH: process.env.PATH,
			ZEROBYTE_CONTROLLER_URL: "ws://localhost:3001",
			ZEROBYTE_AGENT_TOKEN: agentToken,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	runtime.localAgent = agentProcess;

	agentProcess.stdout?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.info(`[agent] ${line}`);
	});

	agentProcess.stderr?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.error(`[agent] ${line}`);
	});

	agentProcess.on("exit", (code, signal) => {
		if (runtime.localAgent === agentProcess) {
			runtime.localAgent = null;
		}
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);
	});
}

export async function stopLocalAgentProcess(runtime: LocalAgentState) {
	if (!runtime.localAgent) {
		return;
	}

	const agentProcess = runtime.localAgent;
	runtime.localAgent = null;

	if (agentProcess.exitCode !== null || agentProcess.signalCode !== null) {
		return;
	}

	const exited = new Promise<void>((resolve) => {
		agentProcess.once("exit", () => {
			resolve();
		});
	});

	agentProcess.kill();
	await exited;
}
