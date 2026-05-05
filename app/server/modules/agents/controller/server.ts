import { Data, Effect, Exit, Fiber, Scope } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type { AgentMessage, BackupCancelPayload, BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import {
	createControllerAgentSession,
	type AgentConnectionData,
	type ControllerAgentSession,
	type ControllerAgentSessionEvent,
} from "./session";
import { agentsService } from "../agents.service";
import { validateAgentToken } from "../helpers/tokens";

type AgentEventContext = {
	agentId: string;
	agentName: string;
};

type AgentBackupMessage = Extract<
	AgentMessage,
	{
		type: "backup.started" | "backup.progress" | "backup.completed" | "backup.failed" | "backup.cancelled";
	}
>;

export type AgentManagerEvent =
	| (AgentEventContext & { type: "agent.disconnected" })
	| (AgentEventContext & AgentBackupMessage);

type ControllerAgentSessionHandle = {
	agentId: string;
	session: ControllerAgentSession;
	scope: Scope.CloseableScope;
};

class StopAgentManagerServerError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

export function createAgentManagerRuntime(onEvent: (event: AgentManagerEvent) => void) {
	let sessions = new Map<string, ControllerAgentSessionHandle>();
	let runtimeScope: Scope.CloseableScope | null = null;

	const closeSession = (sessionHandle: ControllerAgentSessionHandle) =>
		Effect.gen(function* () {
			yield* Scope.close(sessionHandle.scope, Exit.succeed(undefined));
			yield* Effect.sync(() => {
				if (sessions.get(sessionHandle.agentId) === sessionHandle) {
					sessions.delete(sessionHandle.agentId);
				}
			});
		});

	const markAgentOfflineForShutdown = (agentId: string) =>
		Effect.tryPromise({
			try: () => agentsService.markAgentOffline(agentId),
			catch: (error) => new StopAgentManagerServerError({ cause: error }),
		}).pipe(
			Effect.catchAll((error) =>
				logger.effect.error(`Failed to mark agent ${agentId} offline during shutdown: ${toMessage(error)}`),
			),
		);

	const closeAllSessions = Effect.gen(function* () {
		const currentSessions = [...sessions.entries()];
		for (const [agentId, sessionHandle] of currentSessions) {
			yield* markAgentOfflineForShutdown(agentId);
			yield* closeSession(sessionHandle);
		}
		sessions = new Map();
	});

	const getSessionHandle = (agentId: string) => sessions.get(agentId);
	const getSession = (agentId: string) => getSessionHandle(agentId)?.session;

	const handleSessionEvent = (params: { agentId: string; agentName: string; sessionId: string }) => {
		const { agentId, agentName } = params;

		return (event: ControllerAgentSessionEvent) => {
			switch (event.type) {
				case "agent.ready": {
					const at = Date.now();
					return Effect.promise(async () => {
						await agentsService.markAgentOnline(agentId, at);
					});
				}
				case "heartbeat.pong": {
					const at = Date.now();
					return Effect.promise(() => agentsService.markAgentSeen(agentId, at));
				}
				case "agent.disconnected": {
					return Effect.sync(() => onEvent({ type: "agent.disconnected", agentId, agentName }));
				}
				default: {
					return Effect.sync(() => onEvent({ ...event, agentId, agentName }));
				}
			}
		};
	};

	const createSession = (ws: Bun.ServerWebSocket<AgentConnectionData>) =>
		Effect.gen(function* () {
			const scope = yield* Scope.make();

			const session = yield* Scope.extend(
				createControllerAgentSession(
					ws,
					handleSessionEvent({
						agentId: ws.data.agentId,
						agentName: ws.data.agentName,
						sessionId: ws.data.id,
					}),
				),
				scope,
			);
			const runFiber = yield* Effect.forkDaemon(Scope.extend(session.run, scope));
			yield* Scope.addFinalizer(scope, Fiber.interrupt(runFiber));

			return { agentId: ws.data.agentId, session, scope };
		});

	const setSession = (sessionHandle: ControllerAgentSessionHandle) =>
		Effect.gen(function* () {
			const existingSession = sessions.get(sessionHandle.agentId);
			sessions.set(sessionHandle.agentId, sessionHandle);

			if (existingSession) {
				yield* closeSession(existingSession);
			}
		});

	const removeSession = (agentId: string, connectionId: string) =>
		Effect.gen(function* () {
			const handle = sessions.get(agentId);
			if (!handle || handle.session.connectionId !== connectionId) {
				return false;
			}

			yield* closeSession(handle);

			yield* Effect.promise(() => agentsService.markAgentOffline(agentId));
			return true;
		});

	const handleMessage = (ws: Bun.ServerWebSocket<AgentConnectionData>, data: unknown) =>
		Effect.gen(function* () {
			if (typeof data !== "string") {
				yield* logger.effect.warn(`Ignoring non-text message from agent ${ws.data.agentId}`);
				return;
			}

			const session = getSession(ws.data.agentId);
			if (!session || session.connectionId !== ws.data.id) {
				yield* logger.effect.warn(`No active session for agent ${ws.data.agentId} on ${ws.data.id}`);
				return;
			}

			yield* session.handleMessage(data);
		});

	const handleOpen = (ws: Bun.ServerWebSocket<AgentConnectionData>) =>
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				agentsService.markAgentConnecting({
					agentId: ws.data.agentId,
					organizationId: ws.data.organizationId,
					agentName: ws.data.agentName,
					agentKind: ws.data.agentKind,
				}),
			);

			const sessionHandle = yield* createSession(ws);
			yield* setSession(sessionHandle);
			yield* logger.effect.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) connected on ${ws.data.id}`);
		});

	const handleClose = (ws: Bun.ServerWebSocket<AgentConnectionData>) =>
		Effect.gen(function* () {
			yield* removeSession(ws.data.agentId, ws.data.id);
			yield* logger.effect.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) disconnected`);
		});

	const runWebSocketHandler = (
		ws: Bun.ServerWebSocket<AgentConnectionData>,
		event: string,
		effect: Effect.Effect<void>,
	) =>
		Effect.runPromise(
			effect.pipe(
				Effect.catchAllCause((cause) =>
					logger.effect.error(
						`Agent websocket ${event} failed for ${ws.data.agentId} on ${ws.data.id}: ${toMessage(cause)}`,
					),
				),
			),
		);

	const acquireServer = Effect.acquireRelease(
		Effect.sync(() =>
			Bun.serve<AgentConnectionData>({
				port: 3001,
				async fetch(req, srv) {
					const authorizationHeader = req.headers.get("authorization");
					const token = authorizationHeader?.slice("Bearer ".length);

					if (!token) {
						return new Response("Missing token", { status: 401 });
					}

					const result = await validateAgentToken(token);
					if (!result) {
						return new Response("Invalid or revoked token", { status: 401 });
					}

					const upgraded = srv.upgrade(req, {
						data: {
							id: Bun.randomUUIDv7(),
							agentId: result.agentId,
							organizationId: result.organizationId,
							agentName: result.agentName,
							agentKind: result.agentKind,
						},
					});
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				},
				websocket: {
					open: async (ws) => {
						await runWebSocketHandler(ws, "open", handleOpen(ws));
						if (getSession(ws.data.agentId)?.connectionId !== ws.data.id) {
							ws.close();
						}
					},
					message: async (ws, data) => {
						await runWebSocketHandler(ws, "message", handleMessage(ws, data));
					},
					close: async (ws) => {
						await runWebSocketHandler(ws, "close", handleClose(ws));
					},
				},
			}),
		),
		(server) =>
			closeAllSessions.pipe(
				Effect.andThen(
					Effect.tryPromise({
						try: () => server.stop(true),
						catch: (error) => new StopAgentManagerServerError({ cause: error }),
					}),
				),
				Effect.catchAll((error) => {
					return logger.effect.error(`Failed to stop Agent Manager server: ${toMessage(error.cause)}`);
				}),
			),
	);

	const stop = Effect.gen(function* () {
		if (!runtimeScope) {
			return;
		}

		logger.info("Stopping Agent Manager...");
		const scope = runtimeScope;
		runtimeScope = null;
		yield* Scope.close(scope, Exit.succeed(undefined));
	});

	const start = Effect.gen(function* () {
		if (runtimeScope) {
			yield* stop;
		}

		logger.info("Starting Agent Manager...");
		const scope = yield* Scope.make();

		const server = yield* Scope.extend(acquireServer, scope).pipe(
			Effect.catchAllCause((cause) =>
				Scope.close(scope, Exit.failCause(cause)).pipe(Effect.andThen(Effect.failCause(cause))),
			),
		);
		runtimeScope = scope;
		logger.info(`Agent Manager listening on port ${server.port}`);
	});

	return {
		start,
		sendBackup: (agentId: string, payload: BackupRunPayload) =>
			Effect.gen(function* () {
				const session = getSession(agentId);

				if (!session) {
					logger.warn(`Cannot send backup command. Agent ${agentId} is not connected.`);
					return false;
				}

				if (!(yield* session.isReady())) {
					logger.warn(`Cannot send backup command. Agent ${agentId} is not ready.`);
					return false;
				}

				if (!(yield* session.sendBackup(payload))) {
					logger.warn(`Cannot send backup command. Agent ${agentId} is no longer accepting commands.`);
					return false;
				}

				logger.info(`Sent backup command ${payload.jobId} to agent ${agentId} for schedule ${payload.scheduleId}`);
				return true;
			}),
		cancelBackup: (agentId: string, payload: BackupCancelPayload) =>
			Effect.gen(function* () {
				const session = getSession(agentId);

				if (!session) {
					logger.warn(`Cannot cancel backup command. Agent ${agentId} is not connected.`);
					return false;
				}

				if (!(yield* session.sendBackupCancel(payload))) {
					logger.warn(`Cannot cancel backup command. Agent ${agentId} is no longer accepting commands.`);
					return false;
				}

				logger.info(`Sent backup cancel for command ${payload.jobId} to agent ${agentId}`);
				return true;
			}),
		stop,
	};
}

export type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
