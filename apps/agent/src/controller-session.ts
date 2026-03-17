import { Effect, Fiber, Queue } from "effect";
import {
	createAgentMessage,
	parseControllerMessage,
	type AgentWireMessage,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";

const toMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};

export type ControllerSession = {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	close: () => void;
};

export const createControllerSession = (ws: WebSocket): ControllerSession => {
	const outboundQueue = Effect.runSync(Queue.bounded<AgentWireMessage>(64));
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));

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

				switch (parsed.data.type) {
					case "backup.run": {
						logger.info(`Starting backup ${parsed.data.payload.jobId} for schedule ${parsed.data.payload.scheduleId}`);
						yield* Queue.offer(
							outboundQueue,
							createAgentMessage("backup.started", {
								jobId: parsed.data.payload.jobId,
								scheduleId: parsed.data.payload.scheduleId,
							}),
						);
						break;
					}
					case "heartbeat.ping": {
						yield* Queue.offer(
							outboundQueue,
							createAgentMessage("heartbeat.pong", {
								sentAt: parsed.data.payload.sentAt,
							}),
						);
						break;
					}
				}
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
			void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
			void Effect.runPromise(Fiber.interrupt(processorFiber)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
			void Effect.runPromise(Queue.shutdown(inboundQueue)).catch(() => {});
		},
	};
};
