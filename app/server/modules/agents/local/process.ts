import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { logger } from "@zerobyte/core/node";
import { config } from "../../../core/config";
import { deriveLocalAgentToken } from "../helpers/tokens";

type LocalAgentState = {
	localAgent: ChildProcess | null;
	isStoppingLocalAgent: boolean;
	localAgentRestartTimeout: ReturnType<typeof setTimeout> | null;
};

export async function spawnLocalAgentProcess(runtime: LocalAgentState, controllerUrl: string) {
	await stopLocalAgentProcess(runtime);

	if (!config.flags.enableLocalAgent) {
		return;
	}

	const sourceEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
	const productionEntryPoint = path.join(process.cwd(), ".output", "agent", "index.mjs");
	const tsxEntryPoint = path.join(process.cwd(), "node_modules", ".bin", "tsx");

	if (config.__prod__ && !existsSync(productionEntryPoint)) {
		throw new Error(`Local agent entrypoint not found at ${productionEntryPoint}`);
	}

	const agentEntryPoint = config.__prod__ ? productionEntryPoint : sourceEntryPoint;
	const agentToken = await deriveLocalAgentToken();
	const command = config.__prod__ ? "node" : tsxEntryPoint;
	const args = config.__prod__ ? [agentEntryPoint] : ["watch", agentEntryPoint];
	const agentProcess = spawn(command, args, {
		env: {
			...process.env,
			ZEROBYTE_CONTROLLER_URL: controllerUrl,
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
		const shouldRestart = runtime.localAgent === agentProcess && !runtime.isStoppingLocalAgent;
		if (runtime.localAgent === agentProcess) {
			runtime.localAgent = null;
		}
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);

		if (!shouldRestart) {
			return;
		}

		runtime.localAgentRestartTimeout = setTimeout(() => {
			runtime.localAgentRestartTimeout = null;
			void spawnLocalAgentProcess(runtime, controllerUrl).catch((error) => {
				logger.error(
					`Failed to restart local agent: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
		}, 1_000);
	});
}

export async function stopLocalAgentProcess(runtime: LocalAgentState) {
	if (runtime.localAgentRestartTimeout) {
		clearTimeout(runtime.localAgentRestartTimeout);
		runtime.localAgentRestartTimeout = null;
	}

	if (!runtime.localAgent) {
		return;
	}

	const agentProcess = runtime.localAgent;
	runtime.localAgent = null;
	runtime.isStoppingLocalAgent = true;

	if (agentProcess.exitCode !== null || agentProcess.signalCode !== null) {
		runtime.isStoppingLocalAgent = false;
		return;
	}

	const exited = new Promise<void>((resolve) => {
		agentProcess.once("exit", () => {
			runtime.isStoppingLocalAgent = false;
			resolve();
		});
	});

	agentProcess.kill();
	await exited;
}
