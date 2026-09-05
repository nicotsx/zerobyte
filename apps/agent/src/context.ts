import type { AgentWireMessage } from "@zerobyte/contracts/agent-protocol";
import type { Effect } from "effect";
import type { AgentExecutionPolicy } from "./execution-policy";

export type RunningJob =
	| { kind: "backup"; scheduleId: string; abortController: AbortController }
	| { kind: "restore"; abortController: AbortController };

export type ControllerCommandContext = {
	executionPolicy: AgentExecutionPolicy;
	getRunningJob: (jobId: string) => Effect.Effect<RunningJob | undefined, never, never>;
	setRunningJob: (jobId: string, job: RunningJob) => Effect.Effect<void, never, never>;
	deleteRunningJob: (jobId: string) => Effect.Effect<void, never, never>;
	offerOutbound: (message: AgentWireMessage) => Effect.Effect<boolean, never, never>;
};
