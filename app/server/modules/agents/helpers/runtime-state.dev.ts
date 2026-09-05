import { createAgentRuntimeState, type AgentRuntimeState } from "./runtime-state";

export type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: AgentRuntimeState;
};

export const getDevAgentRuntimeState = (): AgentRuntimeState => {
	const runtimeProcess = process as ProcessWithAgentRuntime;
	runtimeProcess.__zerobyteAgentRuntime ??= createAgentRuntimeState();
	return runtimeProcess.__zerobyteAgentRuntime;
};
