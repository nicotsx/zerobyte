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

export type ControllerSession = {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	close: () => void;
};

export const createControllerSession = (ws: WebSocket): ControllerSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<AgentWireMessage>(64));
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));
	const runningJobsRef = Effect.runSync(
		Ref.make<Map<string, { scheduleId: string; abortController: AbortController }>>(new Map()),
	);

	const getRunningJob = (jobId: string) => Effect.runSync(Ref.get(runningJobsRef)).get(jobId);

	const setRunningJob = (jobId: string, job: { scheduleId: string; abortController: AbortController }) => {
		Effect.runSync(
			Ref.update(runningJobsRef, (current) => {
				const next = new Map(current);
				next.set(jobId, job);
				return next;
			}),
		);
	};

	const deleteRunningJob = (jobId: string) => {
		Effect.runSync(
			Ref.update(runningJobsRef, (current) => {
				const next = new Map(current);
				next.delete(jobId);
				return next;
			}),
		);
	};

	const offerOutbound = (message: AgentWireMessage) => {
		void Effect.runPromise(Queue.offer(outboundQueue, message)).catch((error) => {
			logger.error(`Failed to queue outbound controller message: ${toMessage(error)}`);
		});
	};

	const offerInbound = (message: ControllerWireMessage) => {
		void Effect.runPromise(Queue.offer(inboundQueue, message)).catch((error) => {
			logger.error(`Failed to queue inbound controller message: ${toMessage(error)}`);
		});
	};

	const commandContext = {
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
			offerOutbound(createAgentMessage("agent.ready", { agentId: "" }));
		},
		onMessage: (data) => {
			if (typeof data !== "string") {
				logger.warn("Agent received a non-text message");
				return;
			}

			offerInbound(data as ControllerWireMessage);
		},
		close: () => {
			const runningJobs = Effect.runSync(Ref.get(runningJobsRef));
			for (const running of runningJobs.values()) {
				running.abortController.abort();
			}
			Effect.runSync(Ref.set(runningJobsRef, new Map()));
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(processorFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(inboundQueue)).catch(() => {});
		},
	};
};
