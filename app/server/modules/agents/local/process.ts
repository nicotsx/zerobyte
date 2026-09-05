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
	runtime.isStoppingLocalAgent = true;

	if (agentProcess.exitCode !== null || agentProcess.signalCode !== null) {
		if (runtime.localAgent === agentProcess) {
			runtime.localAgent = null;
		}
		runtime.isStoppingLocalAgent = false;
		return;
	}

	let gracefulShutdownTimeout: ReturnType<typeof setTimeout> | undefined;
	let forcedShutdownTimeout: ReturnType<typeof setTimeout> | undefined;
	let shutdownPromiseSettled = false;
	const exited = new Promise<void>((resolve, reject) => {
		const confirmTermination = () => {
			if (gracefulShutdownTimeout) clearTimeout(gracefulShutdownTimeout);
			if (forcedShutdownTimeout) clearTimeout(forcedShutdownTimeout);
			agentProcess.off("exit", confirmTermination);
			agentProcess.off("close", confirmTermination);
			if (runtime.localAgent === agentProcess) {
				runtime.localAgent = null;
			}
			runtime.isStoppingLocalAgent = false;
			if (!shutdownPromiseSettled) {
				shutdownPromiseSettled = true;
				resolve();
			}
		};
		agentProcess.once("exit", confirmTermination);
		agentProcess.once("close", confirmTermination);

		gracefulShutdownTimeout = setTimeout(() => {
			logger.warn("Local agent did not stop gracefully; forcing shutdown");
			agentProcess.kill("SIGKILL");
			if (shutdownPromiseSettled) {
				return;
			}

			forcedShutdownTimeout = setTimeout(() => {
				if (shutdownPromiseSettled) {
					return;
				}

				shutdownPromiseSettled = true;
				reject(new Error("Local agent termination was not confirmed after SIGKILL"));
			}, 5_000);
		}, 5_000);
	});

	agentProcess.kill();
	await exited;
}
