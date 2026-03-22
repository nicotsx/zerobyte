import type { AgentWireMessage } from "@zerobyte/contracts/agent-protocol";

export type RunningJob = {
	scheduleId: string;
	abortController: AbortController;
};

export type ControllerCommandContext = {
	getRunningJob: (jobId: string) => RunningJob | undefined;
	setRunningJob: (jobId: string, job: RunningJob) => void;
	deleteRunningJob: (jobId: string) => void;
	offerOutbound: (message: AgentWireMessage) => void;
};
