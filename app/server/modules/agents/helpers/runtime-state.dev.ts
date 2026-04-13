import { createAgentRuntimeState, type AgentRuntimeState } from "./runtime-state";

type LegacyAgentRuntimeState = Omit<AgentRuntimeState, "activeBackupsByScheduleId" | "activeBackupScheduleIdsByJobId"> &
	Partial<Pick<AgentRuntimeState, "activeBackupsByScheduleId" | "activeBackupScheduleIdsByJobId">>;

export type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: LegacyAgentRuntimeState;
};

const hasActiveBackupMaps = (runtime: LegacyAgentRuntimeState): runtime is AgentRuntimeState => {
	return runtime.activeBackupsByScheduleId instanceof Map && runtime.activeBackupScheduleIdsByJobId instanceof Map;
};

const hydrateAgentRuntimeState = (runtime: LegacyAgentRuntimeState): AgentRuntimeState => ({
	...runtime,
	activeBackupsByScheduleId: runtime.activeBackupsByScheduleId ?? new Map(),
	activeBackupScheduleIdsByJobId: runtime.activeBackupScheduleIdsByJobId ?? new Map(),
});

export const getDevAgentRuntimeState = (): AgentRuntimeState => {
	// Bun reloads modules in place during development, so keep the live runtime on process.
	const runtimeProcess = process as ProcessWithAgentRuntime;
	const existingRuntime = runtimeProcess.__zerobyteAgentRuntime;
	if (!existingRuntime) {
		const runtime = createAgentRuntimeState();
		runtimeProcess.__zerobyteAgentRuntime = runtime;
		return runtime;
	}

	if (hasActiveBackupMaps(existingRuntime)) {
		return existingRuntime;
	}

	const runtime = hydrateAgentRuntimeState(existingRuntime);
	runtimeProcess.__zerobyteAgentRuntime = runtime;
	return runtime;
};
