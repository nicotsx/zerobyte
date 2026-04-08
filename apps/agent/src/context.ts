import type { AgentWireMessage } from "@zerobyte/contracts/agent-protocol";
import type { Effect } from "effect";

export type RunningJob = {
	scheduleId: string;
	abortController: AbortController;
};

export type ControllerCommandContext = {
	getRunningJob: (jobId: string) => Effect.Effect<RunningJob | undefined, never, never>;
	setRunningJob: (jobId: string, job: RunningJob) => Effect.Effect<void, never, never>;
	deleteRunningJob: (jobId: string) => Effect.Effect<void, never, never>;
	offerOutbound: (message: AgentWireMessage) => Effect.Effect<boolean, never, never>;
};
