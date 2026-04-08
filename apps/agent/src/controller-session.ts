import { Effect, Fiber, Queue, Ref } from "effect";
import {
	createAgentMessage,
	parseControllerMessage,
	type AgentWireMessage,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { handleControllerCommand } from "./commands";
import type { ControllerCommandContext, RunningJob } from "./context";

export type ControllerSession = {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	close: () => void;
};

export const createControllerSession = (ws: WebSocket): ControllerSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<AgentWireMessage>(64));
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const runningJobsRef = Effect.runSync(Ref.make<Map<string, RunningJob>>(new Map()));

	const getRunningJob = (jobId: string) => Ref.get(runningJobsRef).pipe(Effect.map((map) => map.get(jobId)));

	const setRunningJob = (jobId: string, job: RunningJob) => {
		return Ref.update(runningJobsRef, (current) => {
			const next = new Map(current);
			next.set(jobId, job);
			return next;
		});
	};

	const abortRunningJobs = Effect.gen(function* () {
		const runningJobs = yield* Ref.modify(runningJobsRef, (current) => [current, new Map()]);
		yield* Effect.sync(() => {
			for (const runningJob of runningJobs.values()) {
				runningJob.abortController.abort();
			}
		});
	});

	const deleteRunningJob = (jobId: string) => {
		return Ref.update(runningJobsRef, (current) => {
			const next = new Map(current);
			next.delete(jobId);
			return next;
		});
	};

	const offerOutbound = (message: AgentWireMessage) => {
		return Queue.offer(outboundQueue, message);
	};

	const offerInbound = (message: ControllerWireMessage) => {
		return Queue.offer(inboundQueue, message);
	};

	const commandContext: ControllerCommandContext = {
		getRunningJob,
		setRunningJob,
		deleteRunningJob,
		offerOutbound,
	};

	const writerFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const message = yield* Queue.take(outboundQueue);
				yield* Effect.sync(() => {
					try {
						ws.send(message);
					} catch (error) {
						logger.error(`Failed to send controller message: ${toMessage(error)}`);
					}
				});
			}),
		),
	);

	const processorFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const data = yield* Queue.take(inboundQueue);
				const parsed = parseControllerMessage(data);

				if (parsed === null) {
					logger.warn("Agent received invalid JSON");
					return;
				}

				if (!parsed.success) {
					logger.warn(`Agent received an invalid message: ${parsed.error.message}`);
					return;
				}

				yield* handleControllerCommand(commandContext, parsed.data);
			}),
		),
	);

	return {
		onOpen: () => {
			void Effect.runPromise(offerOutbound(createAgentMessage("agent.ready", { agentId: "" }))).catch((error) => {
				logger.error(`Failed to queue ready message: ${toMessage(error)}`);
			});
		},
		onMessage: (data) => {
			void Effect.runPromise(offerInbound(data as ControllerWireMessage)).catch((error) => {
				logger.error(`Failed to queue inbound message: ${toMessage(error)}`);
			});
		},
		close: () => {
			void Effect.runPromise(abortRunningJobs).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(processorFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(inboundQueue)).catch(() => {});
		},
	};
};
