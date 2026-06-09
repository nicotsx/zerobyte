import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { Data, Effect, Exit, Fiber, Scope } from "effect";
import { logger, webSocketRawDataToString } from "@zerobyte/core/node";
import { toMessage } from "@zerobyte/core/utils";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type {
	AgentMessage,
	AgentProtocolRejection,
	BackupCancelPayload,
	BackupRunPayload,
	RestoreCancelPayload,
	RestoreRunPayload,
	VolumeCommand,
	VolumeCommandResponsePayload,
} from "@zerobyte/contracts/agent-protocol";
import {
	createControllerAgentSession,
	type AgentSocket,
	type ControllerAgentSession,
	type ControllerAgentSessionEvent,
} from "./session";
import { agentsService } from "../agents.service";
import { validateAgentToken } from "../helpers/tokens";

type AgentEventContext = {
	agentId: string;
	agentName: string;
};

export type AgentManagerEvent =
	| (AgentEventContext & { type: "agent.disconnected" })
	| (AgentEventContext & { type: "agent.protocolRejected"; payload: AgentProtocolRejection })
	| (AgentEventContext & AgentMessage);

type ControllerAgentSessionHandle = {
	agentId: string;
	session: ControllerAgentSession;
	scope: Scope.CloseableScope;
};

type AgentManagerServer = {
	port: number;
	stop: () => Promise<void>;
};

type NodeAgentSocket = WebSocket & AgentSocket;

class StopAgentManagerServerError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

export function createAgentManagerRuntime(onEvent: (event: AgentManagerEvent) => void) {
	let sessions = new Map<string, ControllerAgentSessionHandle>();
	let runtimeScope: Scope.CloseableScope | null = null;
	let controllerUrl: string | null = null;
	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

	const isAgentReady = (agentId: string) => {
		const session = getSession(agentId);
		return !!session && Effect.runSync(session.isReady());
	};

	const handleSessionEvent = (params: { agentId: string; agentName: string }) => {
		const { agentId, agentName } = params;

		return (event: ControllerAgentSessionEvent) => {
			switch (event.type) {
				case "agent.ready": {
					const at = Date.now();
					return Effect.promise(async () => {
						await agentsService.markAgentOnline(agentId, at, {
							...event.payload.capabilities,
							protocolVersion: event.payload.protocolVersion,
							protocolCompatible: true,
							hostname: event.payload.hostname,
							platform: event.payload.platform,
						});
					});
				}
				case "agent.protocolRejected": {
					return Effect.sync(() =>
						onEvent({ type: "agent.protocolRejected", agentId, agentName, payload: event.payload }),
					);
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

	const createSession = (ws: AgentSocket) =>
		Effect.gen(function* () {
			const scope = yield* Scope.make();

			const session = yield* Scope.extend(
				createControllerAgentSession(
					ws,
					handleSessionEvent({
						agentId: ws.data.agentId,
						agentName: ws.data.agentName,
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

	const handleMessage = (ws: AgentSocket, data: unknown) =>
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

	const handleOpen = (ws: AgentSocket) =>
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

	const handleClose = (ws: AgentSocket) =>
		Effect.gen(function* () {
			yield* removeSession(ws.data.agentId, ws.data.id);
			yield* logger.effect.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) disconnected`);
		});

	const runWebSocketHandler = (ws: AgentSocket, event: string, effect: Effect.Effect<void>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.catchAllCause((cause) =>
					logger.effect.error(
						`Agent websocket ${event} failed for ${ws.data.agentId} on ${ws.data.id}: ${toMessage(cause)}`,
					),
				),
			),
		);

	const rejectUpgrade = (socket: Duplex, status: number, statusText: string, message: string) => {
		socket.write(
			[
				`HTTP/1.1 ${status} ${statusText}`,
				"Connection: close",
				`Content-Length: ${Buffer.byteLength(message)}`,
				"Content-Type: text/plain; charset=utf-8",
				"",
				message,
			].join("\r\n"),
		);
		socket.destroy();
	};

	const toTextMessage = (data: RawData, isBinary: boolean): unknown => {
		if (isBinary) {
			return data;
		}

		return webSocketRawDataToString(data);
	};

	const startServer = () =>
		new Promise<AgentManagerServer>((resolve, reject) => {
			const httpServer = createServer((_request, response) => {
				response.writeHead(404);
				response.end();
			});
			const websocketServer = new WebSocketServer({ noServer: true });

			const stop = async () => {
				for (const client of websocketServer.clients) {
					client.terminate();
				}

				await Promise.all([
					new Promise<void>((closeResolve, closeReject) => {
						websocketServer.close((error) => {
							if (error) {
								closeReject(error);
								return;
							}

							closeResolve();
						});
					}),
					new Promise<void>((closeResolve, closeReject) => {
						if (!httpServer.listening) {
							closeResolve();
							return;
						}

						httpServer.close((error) => {
							if (error) {
								closeReject(error);
								return;
							}

							closeResolve();
						});
					}),
				]);
			};

			const handleUpgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
				const rawAuthorizationHeader = request.headers.authorization;
				const authorizationHeader = Array.isArray(rawAuthorizationHeader)
					? rawAuthorizationHeader[0]
					: rawAuthorizationHeader;
				const token = authorizationHeader?.slice("Bearer ".length);

				if (!token) {
					rejectUpgrade(socket, 401, "Unauthorized", "Missing token");
					return;
				}

				const result = await validateAgentToken(token);
				if (!result) {
					rejectUpgrade(socket, 401, "Unauthorized", "Invalid or revoked token");
					return;
				}

				websocketServer.handleUpgrade(request, socket, head, (websocket) => {
					const agentSocket = websocket as NodeAgentSocket;
					agentSocket.data = {
						id: crypto.randomUUID(),
						agentId: result.agentId,
						organizationId: result.organizationId,
						agentName: result.agentName,
						agentKind: result.agentKind,
					};
					websocketServer.emit("connection", agentSocket, request);
				});
			};

			httpServer.on("upgrade", (request, socket, head) => {
				void handleUpgrade(request, socket, head).catch((error) => {
					logger.error(`Agent websocket upgrade failed: ${toMessage(error)}`);
					rejectUpgrade(socket, 400, "Bad Request", "WebSocket upgrade failed");
				});
			});

			websocketServer.on("connection", (socket) => {
				const ws = socket as NodeAgentSocket;

				void runWebSocketHandler(ws, "open", handleOpen(ws)).then(() => {
					if (getSession(ws.data.agentId)?.connectionId !== ws.data.id) {
						ws.close();
					}
				});
				ws.on("message", (data, isBinary) => {
					void runWebSocketHandler(ws, "message", handleMessage(ws, toTextMessage(data, isBinary)));
				});
				ws.on("close", () => {
					void runWebSocketHandler(ws, "close", handleClose(ws));
				});
			});

			httpServer.once("error", reject);
			httpServer.listen(0, "127.0.0.1", () => {
				httpServer.off("error", reject);
				const address = httpServer.address();
				if (!address || typeof address === "string") {
					void stop().finally(() => reject(new Error("Agent Manager server did not report a port")));
					return;
				}

				resolve({ port: address.port, stop });
			});
		});

	const acquireServer = Effect.acquireRelease(
		Effect.tryPromise({
			try: startServer,
			catch: (error) => new StopAgentManagerServerError({ cause: error }),
		}),
		(server) =>
			closeAllSessions.pipe(
				Effect.andThen(
					Effect.tryPromise({
						try: () => server.stop(),
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
		controllerUrl = null;
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
		controllerUrl = `ws://127.0.0.1:${server.port}`;
		logger.info(`Agent Manager listening on port ${server.port}`);
	});

	return {
		start,
		getControllerUrl: () => controllerUrl,
		waitForAgentReady: async (agentId: string, timeoutMs = 10_000) => {
			const deadline = Date.now() + timeoutMs;

			while (Date.now() < deadline) {
				if (isAgentReady(agentId)) {
					return true;
				}

				await sleep(50);
			}

			return isAgentReady(agentId);
		},
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

				logger.info(
					`Sent backup command ${payload.jobId} to agent ${agentId} for schedule ${payload.scheduleId}`,
				);
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
		sendRestore: (agentId: string, payload: RestoreRunPayload) =>
			Effect.gen(function* () {
				const session = getSession(agentId);

				if (!session) {
					logger.warn(`Cannot send restore command. Agent ${agentId} is not connected.`);
					return false;
				}

				if (!(yield* session.isReady())) {
					logger.warn(`Cannot send restore command. Agent ${agentId} is not ready.`);
					return false;
				}

				if (!(yield* session.sendRestore(payload))) {
					logger.warn(`Cannot send restore command. Agent ${agentId} is no longer accepting commands.`);
					return false;
				}

				logger.info(
					`Sent restore command ${payload.restoreId} to agent ${agentId} for snapshot ${payload.snapshotId}`,
				);
				return true;
			}),
		cancelRestore: (agentId: string, payload: RestoreCancelPayload) =>
			Effect.gen(function* () {
				const session = getSession(agentId);

				if (!session) {
					logger.warn(`Cannot cancel restore command. Agent ${agentId} is not connected.`);
					return false;
				}

				if (!(yield* session.sendRestoreCancel(payload))) {
					logger.warn(`Cannot cancel restore command. Agent ${agentId} is no longer accepting commands.`);
					return false;
				}

				logger.info(`Sent restore cancel for command ${payload.restoreId} to agent ${agentId}`);
				return true;
			}),
		runVolumeCommand: (
			agentId: string,
			command: VolumeCommand,
		): Effect.Effect<VolumeCommandResponsePayload | null, Error> =>
			Effect.gen(function* () {
				const session = getSession(agentId);

				if (!session) {
					yield* logger.effect.warn(
						`Cannot send volume command ${command.name}. Agent ${agentId} is not connected.`,
					);
					return null;
				}

				if (!(yield* session.isReady())) {
					yield* logger.effect.warn(
						`Cannot send volume command ${command.name}. Agent ${agentId} is not ready.`,
					);
					return null;
				}

				const result = yield* session.runVolumeCommand(command);
				yield* logger.effect.info(`Completed volume command ${command.name} on agent ${agentId}`);
				return result;
			}),
		stop,
	};
}

export type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
