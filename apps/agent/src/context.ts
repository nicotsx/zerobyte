import type { AgentMessage } from "@zerobyte/contracts/agent-protocol";
import type { Cause, Effect } from "effect";
import type { ResticDeps } from "@zerobyte/core/restic";
import type { TrustedRootRegistry } from "./trusted-roots";
import type { BackupScheduleBusy, UpdateCommitting } from "./update-jobs";

export type RunningJob =
	| { kind: "backup"; scheduleId: string; abortController: AbortController }
	| { kind: "restore"; abortController: AbortController };

type JobAdmissionError = UpdateCommitting | BackupScheduleBusy;

export type ControllerCommandContext = {
	allowRestore: boolean;
	trustedRoots: TrustedRootRegistry;
	resticDeps: (password: string) => ResticDeps;
	startBackupJob: (
		jobId: string,
		job: Extract<RunningJob, { kind: "backup" }>,
		run: Effect.Effect<unknown, Cause.UnknownError>,
	) => Effect.Effect<void, JobAdmissionError>;
	getRunningJob: (jobId: string) => Effect.Effect<RunningJob | undefined, never, never>;
	setRunningJob: (jobId: string, job: RunningJob) => Effect.Effect<void, JobAdmissionError>;
	deleteRunningJob: (jobId: string) => Effect.Effect<void, never, never>;
	offerOutbound: (message: AgentMessage) => Effect.Effect<boolean, Cause.UnknownError, never>;
};
