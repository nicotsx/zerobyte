import type { ChildProcess } from "node:child_process";
import { createAgentManagerRuntime, type AgentManagerRuntime } from "./controller/server";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";

export type { AgentBackupEventHandlers } from "./controller/server";

type AgentRuntimeState = {
	agentManager: AgentManagerRuntime;
	localAgent: ChildProcess | null;
};

type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: AgentRuntimeState;
};

const getAgentRuntimeState = () => {
	const runtimeProcess = process as ProcessWithAgentRuntime;
	const existingRuntime = runtimeProcess.__zerobyteAgentRuntime;

	if (existingRuntime) {
		return existingRuntime;
	}

	const runtime = {
		agentManager: createAgentManagerRuntime(),
		localAgent: null,
	};

	runtimeProcess.__zerobyteAgentRuntime = runtime;
	return runtime;
};

const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;

export const spawnLocalAgent = async () => {
	await spawnLocalAgentProcess(getAgentRuntimeState());
};

export const stopLocalAgent = async () => {
	await stopLocalAgentProcess(getAgentRuntimeState());
};

export const agentManager = getAgentManagerRuntime();

export const stopAgentRuntime = async () => {
	await getAgentManagerRuntime().stop();
	await stopLocalAgent();
};
