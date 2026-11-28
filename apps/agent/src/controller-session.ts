import { Deferred, Effect, Exit, Queue, Ref, Scope } from "effect";
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
import { UpdateCommitting, type UpdateJobs } from "./update-jobs";

export const CONTROLLER_SILENCE_TIMEOUT_MS = 90_000;

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
		updateJobs?: UpdateJobs;
		updateTrial?: AgentCapabilities["updateTrial"];
	},
): ControllerSession => {
	const scope = Scope.makeUnsafe("parallel");
	const startWorker = (run: Effect.Effect<void, unknown>) =>
		Effect.runSync(Effect.forkIn(run, scope, { startImmediately: true }));

	let isClosed = false;
	let silence: { deadline: number; graceGranted: boolean } | undefined;

	const outboundQueue = Effect.runSync(
		Queue.bounded<{ message: AgentMessage; wire: string; sent?: Deferred.Deferred<void> }>(64),
	);
	const closed = Effect.runSync(Deferred.make<void>());
	const inboundQueue = Effect.runSync(Queue.bounded<ControllerWireMessage>(64));

	const runningJobsRef = Effect.runSync(Ref.make<Map<string, RunningJob>>(new Map()));

	const { trustedRoots, builtinLocal = false, excludedPaths = [] } = options;
	const capabilities: AgentCapabilities = {
		agentVersion: process.env.ZEROBYTE_AGENT_VERSION ?? "dev",
		resticVersion: options.resticVersion,
		restore: builtinLocal,
		trustedRoots: getTrustedRootDescriptors(trustedRoots),
		updateTrial: options.updateTrial,
		selfUpdate: options.updateJobs && !builtinLocal ? "systemd" : undefined,
	};

	const diagnostics = createConnectionDiagnostics(Bun.randomUUIDv7(), () => ({
		inboundQueuedMessages: Queue.sizeUnsafe(inboundQueue),
		outboundQueuedMessages: Queue.sizeUnsafe(outboundQueue),
		transportBufferedBytes: ws.bufferedAmount ?? null,
		activeJobs: Effect.runSync(Ref.get(runningJobsRef)).size,
	}));

	const renewSilenceDeadline = () => {
		silence = { deadline: performance.now() + CONTROLLER_SILENCE_TIMEOUT_MS, graceGranted: false };
	};

	const terminateTransport = () => {
		try {
			ws.terminate();
		} catch (error) {
			logger.error(`Failed to terminate controller WebSocket: ${toMessage(error)}`);
		}
	};

	startWorker(
		Effect.forever(
			Effect.gen(function* () {
				yield* Effect.sleep(CONNECTION_DIAGNOSTIC_INTERVAL_MS);

				const timer = diagnostics.checkTimer();
				const missedTick = timer.timerDelayMs >= CONNECTION_DIAGNOSTIC_INTERVAL_MS;

				if (missedTick || Math.abs(timer.clockDriftMs) >= CONNECTION_DIAGNOSTIC_INTERVAL_MS) {
					logger.warn(
						"Agent session timer delayed or clock changed",
						JSON.stringify({ ...diagnostics.snapshot(), ...timer }),
					);
				}

				if (isClosed || silence === undefined) return;

				const now = performance.now();
				if (now < silence.deadline) return;

				// A delayed timer can run before the socket delivers heartbeats that are already waiting.
				if (missedTick && !silence.graceGranted) {
					silence = { deadline: now + CONNECTION_DIAGNOSTIC_INTERVAL_MS, graceGranted: true };
					return;
				}

				logger.warn(
					"Controller stopped sending messages, dropping the connection to reconnect",
					JSON.stringify(diagnostics.snapshot()),
				);
				terminateTransport();
			}),
		),
	);

	const getRunningJob = (jobId: string) => Ref.get(runningJobsRef).pipe(Effect.map((map) => map.get(jobId)));

	const setRunningJob = (jobId: string, job: RunningJob) =>
		Effect.gen(function* () {
			if (isClosed) return yield* new UpdateCommitting();
			if (job.kind === "backup") {
				const rejection = options.updateJobs?.admit(job.scheduleId);
				if (rejection) return yield* rejection;
			}

			yield* Ref.update(runningJobsRef, (current) => new Map(current).set(jobId, job));
		});

	const abortRunningJobs = Ref.get(runningJobsRef).pipe(
		Effect.map((jobs) => {
			for (const job of jobs.values()) job.abortController.abort();
		}),
	);

	const deleteRunningJob = (jobId: string) =>
		Ref.update(runningJobsRef, (current) => {
			const next = new Map(current);

			const job = next.get(jobId);
			if (job?.kind === "backup") options.updateJobs?.finish(job.scheduleId);

			next.delete(jobId);
			return next;
		});

	const offerOutbound = (message: AgentMessage) => {
		return Effect.gen(function* () {
			const wire = yield* Effect.try(() => createAgentMessage(message.type, message.payload));
			const terminalJobMessage = /^backup\.(completed|failed|cancelled)$/.test(message.type);
			if (!options.updateJobs || !terminalJobMessage) return yield* Queue.offer(outboundQueue, { message, wire });

			const sent = yield* Deferred.make<void>();
			yield* Queue.offer(outboundQueue, { message, wire, sent });
			yield* Effect.raceFirst(Deferred.await(sent), Deferred.await(closed));
			return !isClosed;
		});
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
		startBackupJob: (jobId, job, run) => {
			const backup = run.pipe(Effect.ensuring(deleteRunningJob(jobId)), Effect.interruptible);
			const fork = options.updateJobs ? options.updateJobs.fork(backup) : Effect.forkChild(backup);

			return setRunningJob(jobId, job).pipe(Effect.andThen(fork), Effect.asVoid, Effect.uninterruptible);
		},
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
		Effect.runSync(Deferred.succeed(closed, undefined));
		logger.info("Agent session closed", JSON.stringify(diagnostics.snapshot()));

		void Effect.runPromise(
			abortRunningJobs.pipe(
				Effect.andThen(Effect.all([Queue.shutdown(outboundQueue), Queue.shutdown(inboundQueue)])),
				Effect.ensuring(Scope.close(scope, Exit.void)),
			),
		).catch((error) => logger.error(`Agent session cleanup failed: ${toMessage(error)}`));
	};

	const handleSendFailure = (reason: string) => {
		logger.error(`Closing agent session after an outbound websocket send failed: ${reason}`);

		terminateTransport();
		closeSession();
	};

	startWorker(
		Effect.forever(
			Effect.gen(function* () {
				const { message, wire, sent } = yield* Queue.take(outboundQueue);

				yield* Effect.sync(() => {
					try {
						ws.send(wire);
					} catch (error) {
						handleSendFailure(toMessage(error));
						return;
					}

					if (message.type === "heartbeat.pong") {
						diagnostics.onHeartbeatSent("pong", message.payload.sentAt);
					}
				});
				if (sent) yield* Deferred.succeed(sent, undefined);
			}),
		),
	);

	startWorker(
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
			renewSilenceDeadline();

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

			renewSilenceDeadline();
			diagnostics.onReceived();

			void Effect.runPromise(offerInbound(data as ControllerWireMessage)).catch((error) => {
				logger.error(`Failed to queue inbound message: ${toMessage(error)}`);
			});
		},
		close: closeSession,
	};
};
