import type { ChildProcess } from "node:child_process";
import type { ResticBackupOutputDto } from "@zerobyte/core/restic";
import type { BackupProgressPayload } from "@zerobyte/contracts/agent-protocol";
import type { AgentManagerRuntime } from "../controller/server";

export type BackupExecutionProgress = BackupProgressPayload["progress"];
export type BackupExecutionResult =
	| { status: "unavailable"; error: Error }
	| { status: "completed"; exitCode: number; result: ResticBackupOutputDto | null; warningDetails: string | null }
	| { status: "failed"; error: string }
	| { status: "cancelled"; message?: string };

type ActiveBackupRun = {
	scheduleId: number;
	jobId: string;
	scheduleShortId: string;
	onProgress: (progress: BackupExecutionProgress) => void;
	resolve: (result: BackupExecutionResult) => void;
	cancellationRequested: boolean;
};

export type AgentRuntimeState = {
	agentManager: AgentManagerRuntime | null;
	localAgent: ChildProcess | null;
	isStoppingLocalAgent: boolean;
	localAgentRestartTimeout: ReturnType<typeof setTimeout> | null;
	activeBackupsByScheduleId: Map<number, ActiveBackupRun>;
	activeBackupScheduleIdsByJobId: Map<string, number>;
};

export const createAgentRuntimeState = (): AgentRuntimeState => ({
	agentManager: null,
	localAgent: null,
	isStoppingLocalAgent: false,
	localAgentRestartTimeout: null,
	activeBackupsByScheduleId: new Map(),
	activeBackupScheduleIdsByJobId: new Map(),
});
