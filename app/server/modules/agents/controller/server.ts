import { Cause, Effect, Stream, SubscriptionRef, type Duration } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import {
	createControllerMessage,
	type BackupCancelPayload,
	type ControllerWireMessage,
	type BackupRunPayload,
	type FilesystemCommand,
	type RestoreCancelPayload,
	type RestoreRunPayload,
} from "@zerobyte/contracts/agent-protocol";
import { agentsService } from "../agents.service";
import {
	createAgentConnection,
	type AgentConnection,
	type AgentConnectionData,
	type ConnectionEvent,
	type ControllerTransport,
} from "./connection";
import { createAgentControllerListener } from "./listener";

type AgentEventContext = { agentId: string; agentName: string };

export type AgentManagerEvent =
	| (AgentEventContext & { type: "agent.disconnected" })
	| (AgentEventContext & ConnectionEvent);

const closeTransport = (transport: ControllerTransport, code: number, reason: string) => {
	try {
		transport.close(code, reason);
	} catch (error) {
		logger.warn(`Failed to close agent socket: ${toMessage(error)}`);
	}
};

export const createAgentController = (onEvent: (event: AgentManagerEvent) => void | Promise<void>) => {
	const connections = new Map<string, AgentConnection>();
	const readiness = Effect.runSync(SubscriptionRef.make(0));

	let listener: ReturnType<typeof createAgentControllerListener> | null = null;
	let running = false;

	const signalReadiness = SubscriptionRef.update(readiness, (version) => version + 1);

	const emit = (event: AgentManagerEvent) =>
		Effect.tryPromise({
			try: async () => onEvent(event),
			catch: (error) => new Error(`Agent event ${event.type} failed: ${toMessage(error)}`),
		});

	const retire = (connection: AgentConnection) =>
		Effect.gen(function* () {
			const { agentId, agentName } = connection.data;

			if (connections.get(agentId) === connection) {
				connections.delete(agentId);

				yield* Effect.tryPromise(() => agentsService.markAgentOffline(connection.data)).pipe(
					Effect.catch((error) =>
						logger.effect.error(`Failed to mark agent ${agentId} offline: ${toMessage(error)}`),
					),
				);
			}

			yield* emit({ type: "agent.disconnected", agentId, agentName }).pipe(
				Effect.catch((error) => logger.effect.error(toMessage(error))),
			);
			yield* signalReadiness;
		});

	const findConnection = (data: AgentConnectionData) => {
		const connection = connections.get(data.agentId);

		return connection?.data.id === data.id ? connection : undefined;
	};

	const isReady = (agentId: string) => connections.get(agentId)?.isReady() ?? false;

	const open = (data: AgentConnectionData, transport: ControllerTransport) =>
		Effect.gen(function* () {
			if (!running) return closeTransport(transport, 1008, "controller_stopping");

			const connection: AgentConnection = createAgentConnection(data, transport, {
				onEvent: (event) => emit({ ...event, agentId: data.agentId, agentName: data.agentName }),
				onReady: signalReadiness,
				onClosed: Effect.suspend(() => retire(connection)),
			});

			const previous = connections.get(data.agentId);

			connections.set(data.agentId, connection);

			if (previous) yield* previous.close("connection_replaced");

			yield* connection.start;
		});

	const disconnect = (agentId: string) =>
		Effect.suspend(() => {
			const connection = connections.get(agentId);

			if (!connection) return Effect.succeed(false);

			return connection.close("disconnected_by_controller").pipe(Effect.as(true));
		});

	const dispatch = (
		agentId: string,
		admits: (connection: AgentConnection) => boolean,
		createMessage: () => ControllerWireMessage,
	) =>
		Effect.suspend(() => {
			const connection = connections.get(agentId);

			return connection && admits(connection) ? connection.send(createMessage()) : Effect.succeed(false);
		});

	const runSocketEffect = (data: AgentConnectionData, effect: Effect.Effect<void>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.catchCause((cause) =>
					logger.effect.error(
						`Agent connection ${data.id} for ${data.agentId} failed: ${Cause.pretty(cause)}`,
					),
				),
			),
		);

	const socket = {
		open: (data: AgentConnectionData, transport: ControllerTransport) =>
			runSocketEffect(data, open(data, transport)),

		message: (data: AgentConnectionData, transport: ControllerTransport, text: string | null) => {
			if (text === null) {
				closeTransport(transport, 1003, "text_messages_only");
				return Promise.resolve();
			}

			return runSocketEffect(
				data,
				Effect.suspend(() => findConnection(data)?.receive(text) ?? Effect.void),
			);
		},

		close: (data: AgentConnectionData) =>
			runSocketEffect(
				data,
				Effect.suspend(() => findConnection(data)?.close("connection_closed") ?? Effect.void),
			),
	};

	const start = Effect.suspend(() => {
		if (listener) return Effect.void;

		return Effect.try({
			try: () => createAgentControllerListener({ isRunning: () => running, socket }),
			catch: (error) => (error instanceof Error ? error : new Error(toMessage(error))),
		}).pipe(
			Effect.tap((created) =>
				Effect.sync(() => {
					listener = created;
					running = true;
				}),
			),
			Effect.asVoid,
		);
	});

	const stop = Effect.gen(function* () {
		const stoppingListener = listener;

		running = false;
		listener = null;

		yield* Effect.forEach([...connections.values()], (connection) => connection.close("controller_shutdown"), {
			concurrency: "unbounded",
			discard: true,
		});

		if (stoppingListener) {
			yield* Effect.tryPromise(() => stoppingListener.stop(false)).pipe(
				Effect.catch((error) => logger.effect.error(`Failed to stop agent listener: ${toMessage(error)}`)),
			);
		}

		yield* signalReadiness;
	});

	return {
		start,
		stop,
		isRunning: () => running,
		getControllerUrl: () => (listener ? `ws://127.0.0.1:${listener.port}` : null),
		socket,
		disconnect,
		isReady,

		waitForReady: (agentId: string, timeout: Duration.Input) =>
			SubscriptionRef.changes(readiness).pipe(
				Stream.filter(() => !running || isReady(agentId)),
				Stream.runHead,
				Effect.timeoutOption(timeout),
				Effect.map(() => isReady(agentId)),
			),

		sendBackup: (agentId: string, payload: BackupRunPayload) =>
			dispatch(
				agentId,
				(connection) => connection.canBackup(payload.organizationId),
				() => createControllerMessage("backup.run", payload),
			),

		cancelBackup: (agentId: string, payload: BackupCancelPayload) =>
			dispatch(
				agentId,
				(connection) => connection.isReady(),
				() => createControllerMessage("backup.cancel", payload),
			),

		sendRestore: (agentId: string, payload: RestoreRunPayload) =>
			dispatch(
				agentId,
				(connection) => connection.canRestore(payload.organizationId),
				() => createControllerMessage("restore.run", payload),
			),

		cancelRestore: (agentId: string, payload: RestoreCancelPayload) =>
			dispatch(
				agentId,
				(connection) => connection.isReady(),
				() => createControllerMessage("restore.cancel", payload),
			),

		runFilesystemCommand: (agentId: string, organizationId: string, command: FilesystemCommand) =>
			Effect.suspend(() => {
				const connection = connections.get(agentId);

				if (!connection?.canAccessRoot(command.source.rootId, organizationId)) return Effect.succeed(null);

				return connection.runFilesystemCommand(command);
			}),
	};
};

export type AgentController = ReturnType<typeof createAgentController>;
