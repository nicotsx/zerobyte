import { Effect, Fiber, Queue, Ref } from "effect";
import {
	AGENT_PROTOCOL_VERSION,
	createAgentMessage,
	parseControllerMessage,
	type AgentCapabilities,
	type AgentMessage,
	type ControllerWireMessage,
} from "@zerobyte/contracts/agent-protocol";
import {
	logger,
	createConnectionDiagnostics,
	CONNECTION_DIAGNOSTIC_INTERVAL_MS,
	resolveResticHostname,
} from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { handleControllerCommand } from "./commands";
import type { ControllerCommandContext, RunningJob } from "./context";
import { getTrustedRootDescriptors, type TrustedRootRegistry } from "./trusted-roots";
import { resticDeps } from "./restic/deps";

export type ControllerSession = {
	onOpen: () => void;
	onMessage: (data: unknown) => void;
	close: () => void;
};

export const createControllerSession = (
	ws: WebSocket,
	options: {
		trustedRoots: TrustedRootRegistry;
		builtinLocal?: boolean;
		excludedPaths?: string[];
		resticVersion?: string;
	},
): ControllerSession => {
	let isClosed = false;

	const outboundQueue = Effect.runSync(Queue.bounded<AgentMessage>(64));
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));

	const runningJobsRef = Effect.runSync(Ref.make<Map<string, RunningJob>>(new Map()));

	const { trustedRoots, builtinLocal = false, excludedPaths = [] } = options;
	const capabilities: AgentCapabilities = {
		agentVersion: process.env.ZEROBYTE_AGENT_VERSION ?? "dev",
		resticVersion: options.resticVersion,
		restore: builtinLocal,
		trustedRoots: getTrustedRootDescriptors(trustedRoots),
	};

	const diagnostics = createConnectionDiagnostics(Bun.randomUUIDv7(), () => ({
		inboundQueuedMessages: Queue.sizeUnsafe(inboundQueue),
		outboundQueuedMessages: Queue.sizeUnsafe(outboundQueue),
		transportBufferedBytes: ws.bufferedAmount ?? null,
		activeJobs: Effect.runSync(Ref.get(runningJobsRef)).size,
	}));

	const diagnosticFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				yield* Effect.sleep(CONNECTION_DIAGNOSTIC_INTERVAL_MS);

				const timer = diagnostics.checkTimer();

				if (
					timer.timerDelayMs >= CONNECTION_DIAGNOSTIC_INTERVAL_MS ||
					Math.abs(timer.clockDriftMs) >= CONNECTION_DIAGNOSTIC_INTERVAL_MS
				) {
					logger.warn(
						"Agent session timer delayed or clock changed",
						JSON.stringify({ ...diagnostics.snapshot(), ...timer }),
					);
				}
			}),
		),
	);

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

	const offerOutbound = (message: AgentMessage) => {
		return Queue.offer(outboundQueue, message);
	};

	const offerInbound = (message: ControllerWireMessage) => {
		return Queue.offer(inboundQueue, message);
	};

	const sessionResticDeps = (password: string) => {
		const deps = resticDeps(password);

		return { ...deps, defaultExcludes: [...deps.defaultExcludes, ...excludedPaths] };
	};

	const commandContext: ControllerCommandContext = {
		allowRestore: builtinLocal,
		trustedRoots,
		resticDeps: sessionResticDeps,
		getRunningJob,
		setRunningJob,
		deleteRunningJob,
		offerOutbound,
	};

	const closeSession = () => {
		if (isClosed) {
			return;
		}

		isClosed = true;
		logger.info("Agent session closed", JSON.stringify(diagnostics.snapshot()));

		void Effect.runPromise(Fiber.interrupt(diagnosticFiber)).catch(() => {});
		void Effect.runPromise(abortRunningJobs).catch(() => {});
		void Effect.runPromise(Fiber.interrupt(writerFiber)).catch(() => {});
		void Effect.runPromise(Fiber.interrupt(processorFiber)).catch(() => {});
		void Effect.runPromise(Queue.shutdown(outboundQueue)).catch(() => {});
		void Effect.runPromise(Queue.shutdown(inboundQueue)).catch(() => {});
	};

	const handleSendFailure = (reason: string) => {
		logger.error(`Closing agent session after an outbound websocket send failed: ${reason}`);

		try {
			ws.close();
		} catch (error) {
			logger.error(`Failed to close controller websocket after send failure: ${toMessage(error)}`);
		}

		closeSession();
	};

	const writerFiber = Effect.runFork(
		Effect.forever(
			Effect.gen(function* () {
				const message = yield* Queue.take(outboundQueue);
				yield* Effect.sync(() => {
					try {
						ws.send(createAgentMessage(message.type, message.payload));
					} catch (error) {
						handleSendFailure(toMessage(error));
						return;
					}

					if (message.type === "heartbeat.pong") {
						diagnostics.onHeartbeatSent("pong", message.payload.sentAt);
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

				const commandEffect = Effect.suspend(() => handleControllerCommand(commandContext, parsed.data));
				const handledCommand = commandEffect.pipe(
					Effect.catchCause((cause) =>
						Effect.sync(() => logger.error(`Failed to handle controller message: ${toMessage(cause)}`)),
					),
				);

				// Filesystem reads can wait on a mount; keep session control messages responsive.
				// Child fibers are interrupted when this session's processor is interrupted.
				if (parsed.data.type === "filesystem.command") {
					yield* Effect.forkChild(handledCommand);
				} else {
					diagnostics.onProcessing(parsed.data.type);

					if (parsed.data.type === "heartbeat.ping") {
						diagnostics.onHeartbeatProcessed("ping", parsed.data.payload.sentAt);
					}

					yield* handledCommand.pipe(Effect.ensuring(Effect.sync(diagnostics.onProcessed)));
				}
			}),
		),
	);

	return {
		onOpen: () => {
			void Effect.runPromise(
				offerOutbound({
					type: "agent.ready",
					payload: {
						agentId: "",
						protocolVersion: AGENT_PROTOCOL_VERSION,
						hostname: resolveResticHostname(),
						platform: process.platform,
						capabilities,
					},
				}),
			).catch((error) => {
				logger.error(`Failed to queue ready message: ${toMessage(error)}`);
			});
		},
		onMessage: (data) => {
			if (typeof data !== "string") {
				logger.warn("Agent received a non-text message");
				return;
			}

			diagnostics.onReceived();

			void Effect.runPromise(offerInbound(data as ControllerWireMessage)).catch((error) => {
				logger.error(`Failed to queue inbound message: ${toMessage(error)}`);
			});
		},
		close: closeSession,
	};
};
