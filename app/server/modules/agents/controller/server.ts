import { Data, Effect, Exit, Fiber, Scope } from "effect";
import { logger } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import type {
	BackupCancelPayload,
	BackupCancelledPayload,
	BackupCompletedPayload,
	BackupFailedPayload,
	BackupProgressPayload,
	BackupRunPayload,
	BackupStartedPayload,
} from "@zerobyte/contracts/agent-protocol";
import { createControllerAgentSession, type AgentConnectionData, type ControllerAgentSession } from "./session";
import { agentsService } from "../agents.service";
import { validateAgentToken } from "../helpers/tokens";

type AgentBackupEventContext = {
	agentId: string;
	agentName: string;
	payload:
		| BackupStartedPayload
		| BackupProgressPayload
		| BackupCompletedPayload
		| BackupFailedPayload
		| BackupCancelledPayload;
};

export type AgentBackupEventHandlers = {
	onAgentDisconnected?: (context: { agentId: string; agentName: string }) => void;
	onBackupStarted?: (context: AgentBackupEventContext & { payload: BackupStartedPayload }) => void;
	onBackupProgress?: (context: AgentBackupEventContext & { payload: BackupProgressPayload }) => void;
	onBackupCompleted?: (context: AgentBackupEventContext & { payload: BackupCompletedPayload }) => void;
	onBackupFailed?: (context: AgentBackupEventContext & { payload: BackupFailedPayload }) => void;
	onBackupCancelled?: (context: AgentBackupEventContext & { payload: BackupCancelledPayload }) => void;
};

type ControllerAgentSessionHandle = {
	agentId: string;
	session: ControllerAgentSession;
	scope: Scope.CloseableScope;
};

class StopAgentManagerServerError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

export function createAgentManagerRuntime(handlers: AgentBackupEventHandlers) {
	let sessions = new Map<string, ControllerAgentSessionHandle>();
	let runtimeScope: Scope.CloseableScope | null = null;

	const closeSession = (sessionHandle: ControllerAgentSessionHandle) =>
		Effect.gen(function* () {
			yield* Scope.close(sessionHandle.scope, Exit.succeed(undefined));
			yield* Effect.sync(() => sessions.delete(sessionHandle.agentId));
		});

	const closeAllSessions = Effect.gen(function* () {
		const currentSessions = [...sessions.entries()];
		for (const [agentId, sessionHandle] of currentSessions) {
			yield* Effect.promise(() => agentsService.markAgentOffline(agentId));
			yield* closeSession(sessionHandle);
		}
		sessions = new Map();
	});

	const getSessionHandle = (agentId: string) => sessions.get(agentId);
	const getSession = (agentId: string) => getSessionHandle(agentId)?.session;

	const createSessionHandlers = (params: { agentId: string; agentName: string; sessionId: string }) => {
		const { agentId, agentName, sessionId } = params;

		return {
			onReady: ({ at }: { at: number }) => {
				return Effect.promise(async () => {
					await agentsService.markAgentOnline(agentId, at);
				});
			},
			onHeartbeatPong: ({ at }: { at: number }) => {
				return Effect.promise(() => agentsService.markAgentSeen(agentId, at));
			},
			onDisconnect: () => {
				if (getSession(agentId)?.connectionId !== sessionId) {
					return Effect.void;
				}

				return Effect.sync(() => handlers.onAgentDisconnected?.({ agentId, agentName }));
			},
			onBackupStarted: (payload: BackupStartedPayload) => {
				return Effect.sync(() => handlers.onBackupStarted?.({ agentId, agentName, payload }));
			},
			onBackupProgress: (payload: BackupProgressPayload) => {
				return Effect.sync(() => handlers.onBackupProgress?.({ agentId, agentName, payload }));
			},
			onBackupCompleted: (payload: BackupCompletedPayload) => {
				return Effect.sync(() => handlers.onBackupCompleted?.({ agentId, agentName, payload }));
			},
			onBackupFailed: (payload: BackupFailedPayload) => {
				return Effect.sync(() => handlers.onBackupFailed?.({ agentId, agentName, payload }));
			},
			onBackupCancelled: (payload: BackupCancelledPayload) => {
				return Effect.sync(() => handlers.onBackupCancelled?.({ agentId, agentName, payload }));
			},
		};
	};

	const createSession = (ws: Bun.ServerWebSocket<AgentConnectionData>) =>
		Effect.gen(function* () {
			const scope = yield* Scope.make();

			const session = yield* Scope.extend(
				createControllerAgentSession(
					ws,
					createSessionHandlers({
						agentId: ws.data.agentId,
						agentName: ws.data.agentName,
						sessionId: ws.data.id,
					}),
				),
				scope,
			);
			const runFiber = yield* Effect.fork(Scope.extend(session.run, scope));
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
						await agentsService.markAgentConnecting({
							agentId: ws.data.agentId,
							organizationId: ws.data.organizationId,
							agentName: ws.data.agentName,
							agentKind: ws.data.agentKind,
						});

						const sessionHandle = await Effect.runPromise(createSession(ws));
						await Effect.runPromise(setSession(sessionHandle));

						logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) connected on ${ws.data.id}`);
					},
					message: async (ws, data) => {
						await Effect.runPromise(handleMessage(ws, data));
					},
					close: async (ws) => {
						await Effect.runPromise(removeSession(ws.data.agentId, ws.data.id));
						logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) disconnected`);
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

	const stop = async () => {
		if (!runtimeScope) {
			return;
		}

		logger.info("Stopping Agent Manager...");
		const scope = runtimeScope;
		runtimeScope = null;
		await Effect.runPromise(Scope.close(scope, Exit.succeed(undefined)));
	};

	// TODO: Move the effect boundary up
	const start = async () => {
		if (runtimeScope) {
			await stop();
		}

		logger.info("Starting Agent Manager...");
		const scope = Effect.runSync(Scope.make());

		try {
			const server = Effect.runSync(Scope.extend(acquireServer, scope));
			runtimeScope = scope;
			logger.info(`Agent Manager listening on port ${server.port}`);
		} catch (error) {
			await Effect.runPromise(Scope.close(scope, Exit.fail(error)));
			throw error;
		}
	};

	return {
		start,
		sendBackup: async (agentId: string, payload: BackupRunPayload) => {
			const session = getSession(agentId);

			if (!session) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is not connected.`);
				return false;
			}

			if (!Effect.runSync(session.isReady())) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is not ready.`);
				return false;
			}

			if (!(await Effect.runPromise(session.sendBackup(payload)))) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is no longer accepting commands.`);
				return false;
			}

			logger.info(`Sent backup command ${payload.jobId} to agent ${agentId} for schedule ${payload.scheduleId}`);
			return true;
		},
		cancelBackup: async (agentId: string, payload: BackupCancelPayload) => {
			const session = getSession(agentId);

			if (!session) {
				logger.warn(`Cannot cancel backup command. Agent ${agentId} is not connected.`);
				return false;
			}

			if (!(await Effect.runPromise(session.sendBackupCancel(payload)))) {
				logger.warn(`Cannot cancel backup command. Agent ${agentId} is no longer accepting commands.`);
				return false;
			}

			logger.info(`Sent backup cancel for command ${payload.jobId} to agent ${agentId}`);
			return true;
		},
		stop,
	};
}

export type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
