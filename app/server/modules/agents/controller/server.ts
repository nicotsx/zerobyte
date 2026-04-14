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
	onBackupStarted?: (context: AgentBackupEventContext & { payload: BackupStartedPayload }) => void;
	onBackupProgress?: (context: AgentBackupEventContext & { payload: BackupProgressPayload }) => void;
	onBackupCompleted?: (context: AgentBackupEventContext & { payload: BackupCompletedPayload }) => void;
	onBackupFailed?: (context: AgentBackupEventContext & { payload: BackupFailedPayload }) => void;
	onBackupCancelled?: (context: AgentBackupEventContext & { payload: BackupCancelledPayload }) => void;
};

type ControllerAgentSessionHandle = {
	session: ControllerAgentSession;
	runFiber: Fiber.RuntimeFiber<void, never>;
	scope: Scope.CloseableScope;
};

class StopAgentManagerServerError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

export function createAgentManagerRuntime() {
	let sessions = new Map<string, ControllerAgentSessionHandle>();
	let backupHandlers: AgentBackupEventHandlers = {};
	let runtimeScope: Scope.CloseableScope | null = null;

	const closeSession = (sessionHandle: ControllerAgentSessionHandle) =>
		Effect.gen(function* () {
			yield* Fiber.interrupt(sessionHandle.runFiber);
			yield* Scope.close(sessionHandle.scope, Exit.succeed(undefined));
		});

	const closeAllSessions = Effect.gen(function* () {
		const currentSessions = sessions;
		sessions = new Map();
		for (const sessionHandle of currentSessions.values()) {
			yield* closeSession(sessionHandle);
		}
	});

	const getSessionHandle = (agentId: string) => sessions.get(agentId);

	const getSession = (agentId: string) => getSessionHandle(agentId)?.session;

	const createSessionHandlers = (ws: Bun.ServerWebSocket<AgentConnectionData>) => {
		const agentId = ws.data.agentId;
		const agentName = ws.data.agentName;

		return {
			onReady: ({ at }: { at: number }) => {
				return Effect.promise(() => agentsService.markAgentOnline(agentId, at));
			},
			onHeartbeatPong: ({ at }: { at: number }) => {
				return Effect.promise(() => agentsService.markAgentSeen(agentId, at));
			},
			onBackupStarted: (payload: BackupStartedPayload) => {
				return Effect.sync(() => backupHandlers.onBackupStarted?.({ agentId, agentName, payload }));
			},
			onBackupProgress: (payload: BackupProgressPayload) => {
				return Effect.sync(() => backupHandlers.onBackupProgress?.({ agentId, agentName, payload }));
			},
			onBackupCompleted: (payload: BackupCompletedPayload) => {
				return Effect.sync(() => backupHandlers.onBackupCompleted?.({ agentId, agentName, payload }));
			},
			onBackupFailed: (payload: BackupFailedPayload) => {
				return Effect.sync(() => backupHandlers.onBackupFailed?.({ agentId, agentName, payload }));
			},
			onBackupCancelled: (payload: BackupCancelledPayload) => {
				return Effect.sync(() => backupHandlers.onBackupCancelled?.({ agentId, agentName, payload }));
			},
		};
	};

	const createSession = (ws: Bun.ServerWebSocket<AgentConnectionData>) => {
		// Manual scope management because we are out of Effect
		const scope = Effect.runSync(Scope.make());

		try {
			const session = Effect.runSync(Scope.extend(createControllerAgentSession(ws, createSessionHandlers(ws)), scope));
			const runFiber = Effect.runFork(Scope.extend(session.run, scope));

			return { session, runFiber, scope };
		} catch (error) {
			Effect.runSync(Scope.close(scope, Exit.fail(error)));
			throw error;
		}
	};

	const setSession = (agentId: string, sessionHandle: ControllerAgentSessionHandle) => {
		const existingSession = getSessionHandle(agentId);
		if (existingSession) {
			void Effect.runPromise(closeSession(existingSession)).catch((error) => {
				logger.error(`Failed to close existing agent session for ${agentId}: ${toMessage(error)}`);
			});
		}

		sessions.set(agentId, sessionHandle);
	};

	const removeSession = (agentId: string, connectionId: string) => {
		const sessionHandle = getSessionHandle(agentId);
		if (!sessionHandle || sessionHandle.session.connectionId !== connectionId) {
			return false;
		}

		sessions.delete(agentId);
		void Effect.runPromise(closeSession(sessionHandle)).catch((error) => {
			logger.error(`Failed to close agent session for ${agentId}: ${toMessage(error)}`);
		});
		return true;
	};

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
					open: (ws) => {
						setSession(ws.data.agentId, createSession(ws));
						void agentsService
							.markAgentConnecting({
								agentId: ws.data.agentId,
								organizationId: ws.data.organizationId,
								agentName: ws.data.agentName,
								agentKind: ws.data.agentKind,
							})
							.catch((error) => {
								logger.error(`Failed to mark agent ${ws.data.agentId} as connecting: ${toMessage(error)}`);
							});
						logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) connected on ${ws.data.id}`);
					},
					message: (ws, data) => {
						if (typeof data !== "string") {
							logger.warn(`Ignoring non-text message from agent ${ws.data.agentId}`);
							return;
						}

						const session = getSession(ws.data.agentId);
						if (!session || session.connectionId !== ws.data.id) {
							logger.warn(`No active session for agent ${ws.data.agentId} on ${ws.data.id}`);
							return;
						}

						void Effect.runPromise(session.handleMessage(data)).catch((error) => {
							logger.error(
								`Failed to handle message from agent ${ws.data.agentId} on ${ws.data.id}: ${toMessage(error)}`,
							);
						});
					},
					close: (ws) => {
						removeSession(ws.data.agentId, ws.data.id);
						void agentsService.markAgentOffline(ws.data.agentId).catch((error) => {
							logger.error(`Failed to mark agent ${ws.data.agentId} as offline: ${toMessage(error)}`);
						});
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
				Effect.catchAll((error) =>
					Effect.sync(() => {
						logger.error(`Failed to stop Agent Manager server: ${toMessage(error.cause)}`);
					}),
				),
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
		setBackupEventHandlers: (handlers: AgentBackupEventHandlers) => {
			backupHandlers = handlers;
		},
		getBackupEventHandlers: () => backupHandlers,
		stop,
	};
}

export type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
