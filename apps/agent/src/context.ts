import type { AgentWireMessage } from "@zerobyte/contracts/agent-protocol";
import type { Effect, Queue } from "effect";
import type { ResticDeps } from "@zerobyte/core/restic";
import type { TrustedRootRegistry } from "./trusted-roots";

export type RunningJob =
	| { kind: "backup"; scheduleId: string; abortController: AbortController }
	| { kind: "restore"; abortController: AbortController }
	| { kind: "restic"; abortController: AbortController; resultAcks: Queue.Queue<void> };

export type ControllerCommandContext = {
	trustedRoots: TrustedRootRegistry;
	resticDeps: (password: string) => ResticDeps;
	getRunningJob: (jobId: string) => Effect.Effect<RunningJob | undefined, never, never>;
	setRunningJob: (jobId: string, job: RunningJob) => Effect.Effect<void, never, never>;
	deleteRunningJob: (jobId: string) => Effect.Effect<void, never, never>;
	offerOutbound: (message: AgentWireMessage) => Effect.Effect<boolean, never, never>;
};
