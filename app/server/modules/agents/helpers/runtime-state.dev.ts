import { createAgentRuntimeState, type AgentRuntimeState } from "./runtime-state";

type RuntimeMapKey = "activeBackupsByScheduleId" | "activeBackupScheduleIdsByJobId" | "activeRestoresByRestoreId";

type LegacyAgentRuntimeState = Omit<AgentRuntimeState, RuntimeMapKey> & Partial<Pick<AgentRuntimeState, RuntimeMapKey>>;

export type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: LegacyAgentRuntimeState;
};

const hasActiveRuntimeMaps = (runtime: LegacyAgentRuntimeState): runtime is AgentRuntimeState => {
	return (
		runtime.activeBackupsByScheduleId instanceof Map &&
		runtime.activeBackupScheduleIdsByJobId instanceof Map &&
		runtime.activeRestoresByRestoreId instanceof Map
	);
};

const hydrateAgentRuntimeState = (runtime: LegacyAgentRuntimeState): AgentRuntimeState => ({
	...runtime,
	activeBackupsByScheduleId: runtime.activeBackupsByScheduleId ?? new Map(),
	activeBackupScheduleIdsByJobId: runtime.activeBackupScheduleIdsByJobId ?? new Map(),
	activeRestoresByRestoreId: runtime.activeRestoresByRestoreId ?? new Map(),
});

export const getDevAgentRuntimeState = (): AgentRuntimeState => {
	const runtimeProcess = process as ProcessWithAgentRuntime;
	const existingRuntime = runtimeProcess.__zerobyteAgentRuntime;
	if (!existingRuntime) {
		const runtime = createAgentRuntimeState();
		runtimeProcess.__zerobyteAgentRuntime = runtime;
		return runtime;
	}

	if (hasActiveRuntimeMaps(existingRuntime)) {
		return existingRuntime;
	}

	const runtime = hydrateAgentRuntimeState(existingRuntime);
	runtimeProcess.__zerobyteAgentRuntime = runtime;
	return runtime;
};
