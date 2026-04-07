import type { ChildProcess } from "node:child_process";
import type { BackupCancelPayload, BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { AgentBackupEventHandlers, AgentManagerRuntime } from "./controller/server";
import { spawnLocalAgentProcess, stopLocalAgentProcess } from "./local/process";

export type { AgentBackupEventHandlers } from "./controller/server";

type AgentRuntimeState = {
	agentManager: AgentManagerRuntime | null;
	localAgent: ChildProcess | null;
	isStoppingLocalAgent: boolean;
	localAgentRestartTimeout: ReturnType<typeof setTimeout> | null;
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
		agentManager: null,
		localAgent: null,
		isStoppingLocalAgent: false,
		localAgentRestartTimeout: null,
	};

	runtimeProcess.__zerobyteAgentRuntime = runtime;
	return runtime;
};

const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;

let backupEventHandlers: AgentBackupEventHandlers = {};

export const startAgentRuntime = async () => {
	const runtime = getAgentRuntimeState();

	if (runtime.agentManager) {
		await runtime.agentManager.stop();
	}

	const { createAgentManagerRuntime } = await import("./controller/server");
	const nextAgentManager = createAgentManagerRuntime();
	nextAgentManager.setBackupEventHandlers(backupEventHandlers);

	await nextAgentManager.start();
	runtime.agentManager = nextAgentManager;
};

export const agentManager = {
	sendBackup: (agentId: string, payload: BackupRunPayload) => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			return false;
		}

		return runtime.sendBackup(agentId, payload);
	},
	cancelBackup: (agentId: string, payload: BackupCancelPayload) => {
		const runtime = getAgentManagerRuntime();
		if (!runtime) {
			return false;
		}

		return runtime.cancelBackup(agentId, payload);
	},
	setBackupEventHandlers: (handlers: AgentBackupEventHandlers) => {
		backupEventHandlers = handlers;
		getAgentManagerRuntime()?.setBackupEventHandlers(handlers);
	},
	getBackupEventHandlers: () => {
		return getAgentManagerRuntime()?.getBackupEventHandlers() ?? backupEventHandlers;
	},
};

export const spawnLocalAgent = async () => {
	await spawnLocalAgentProcess(getAgentRuntimeState());
};

export const stopLocalAgent = async () => {
	await stopLocalAgentProcess(getAgentRuntimeState());
};

export const stopAgentRuntime = async () => {
	await getAgentManagerRuntime()?.stop();
	await stopLocalAgent();
};
