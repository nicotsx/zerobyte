import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Exit, Ref, Scope } from "effect";
import { logger } from "@zerobyte/core/node";
import type {
	BackupCancelPayload,
	BackupCancelledPayload,
	BackupCompletedPayload,
	BackupFailedPayload,
	BackupProgressPayload,
	BackupRunPayload,
	BackupStartedPayload,
} from "@zerobyte/contracts/agent-protocol";
import { config } from "../../core/config";
import { validateAgentToken, deriveLocalAgentToken } from "./agent-tokens";
import {
	createControllerAgentSession,
	type AgentConnectionData,
	type ControllerAgentSession,
} from "./controller-agent-session";

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

type AgentManagerRuntime = ReturnType<typeof createAgentManagerRuntime>;
type AgentRuntimeState = {
	agentManager: AgentManagerRuntime;
	localAgent: ChildProcess | null;
};

type ProcessWithAgentRuntime = NodeJS.Process & {
	__zerobyteAgentRuntime?: AgentRuntimeState;
};

const getAgentRuntimeState = () => {
	const runtimeProcess = process as ProcessWithAgentRuntime;
	const existingRuntime = runtimeProcess.__zerobyteAgentRuntime;

	if (existingRuntime) {
		return existingRuntime;
	}

	const runtime = {
		agentManager: createAgentManagerRuntime(),
		localAgent: null,
	};

	runtimeProcess.__zerobyteAgentRuntime = runtime;
	return runtime;
};

const getAgentManagerRuntime = () => getAgentRuntimeState().agentManager;

export const spawnLocalAgent = async () => {
	await stopLocalAgent();

	const sourceEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
	const productionEntryPoint = path.join(process.cwd(), ".output", "agent", "index.mjs");

	if (config.__prod__ && !existsSync(productionEntryPoint)) {
		throw new Error(`Local agent entrypoint not found at ${productionEntryPoint}`);
	}

	const agentEntryPoint = config.__prod__ ? productionEntryPoint : sourceEntryPoint;
	const agentToken = await deriveLocalAgentToken();
	const args = config.__prod__ ? ["run", agentEntryPoint] : ["run", "--watch", agentEntryPoint];

	const runtime = getAgentRuntimeState();
	const agentProcess = spawn("bun", args, {
		env: {
			PATH: process.env.PATH,
			ZEROBYTE_CONTROLLER_URL: "ws://localhost:3001",
			ZEROBYTE_AGENT_TOKEN: agentToken,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	runtime.localAgent = agentProcess;

	agentProcess.stdout?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.info(`[agent] ${line}`);
	});

	agentProcess.stderr?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.error(`[agent] ${line}`);
	});

	agentProcess.on("exit", (code, signal) => {
		if (runtime.localAgent === agentProcess) {
			runtime.localAgent = null;
		}
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);
	});
};

export const stopLocalAgent = async () => {
	const runtime = getAgentRuntimeState();
	if (!runtime.localAgent) {
		return;
	}

	const agentProcess = runtime.localAgent;
	runtime.localAgent = null;

	if (agentProcess.exitCode !== null || agentProcess.signalCode !== null) {
		return;
	}

	const exited = new Promise<void>((resolve) => {
		agentProcess.once("exit", () => {
			resolve();
		});
	});

	agentProcess.kill();
	await exited;
};

const createAgentManagerRuntime = () => {
	const sessionsRef = Effect.runSync(Ref.make<Map<string, ControllerAgentSession>>(new Map()));
	const backupHandlersRef = Effect.runSync(Ref.make<AgentBackupEventHandlers>({}));
	let runtimeScope: Scope.CloseableScope | null = null;

	const getSessions = () => Effect.runSync(Ref.get(sessionsRef));
	const getBackupHandlers = () => Effect.runSync(Ref.get(backupHandlersRef));
	const setSessions = (sessions: Map<string, ControllerAgentSession>) => {
		Effect.runSync(Ref.set(sessionsRef, sessions));
	};
	const setBackupHandlers = (handlers: AgentBackupEventHandlers) => {
		Effect.runSync(Ref.set(backupHandlersRef, handlers));
	};

	const closeAllSessions = () => {
		const sessions = getSessions();
		for (const session of sessions.values()) {
			session.close();
		}
		setSessions(new Map());
	};

	const getSession = (agentId: string) => getSessions().get(agentId);

	const setSession = (agentId: string, session: ControllerAgentSession) => {
		const existingSession = getSession(agentId);
		if (existingSession) {
			existingSession.close();
		}

		const nextSessions = new Map(getSessions());
		nextSessions.set(agentId, session);
		setSessions(nextSessions);
	};

	const removeSession = (agentId: string, connectionId: string) => {
		const session = getSession(agentId);
		if (!session || session.connectionId !== connectionId) {
			return;
		}

		session.close();
		const nextSessions = new Map(getSessions());
		nextSessions.delete(agentId);
		setSessions(nextSessions);
	};

	const handleBackupStarted = (ws: Bun.ServerWebSocket<AgentConnectionData>, payload: BackupStartedPayload) => {
		getBackupHandlers().onBackupStarted?.({ agentId: ws.data.agentId, agentName: ws.data.agentName, payload });
	};

	const handleBackupProgress = (ws: Bun.ServerWebSocket<AgentConnectionData>, payload: BackupProgressPayload) => {
		getBackupHandlers().onBackupProgress?.({ agentId: ws.data.agentId, agentName: ws.data.agentName, payload });
	};

	const handleBackupCompleted = (ws: Bun.ServerWebSocket<AgentConnectionData>, payload: BackupCompletedPayload) => {
		getBackupHandlers().onBackupCompleted?.({ agentId: ws.data.agentId, agentName: ws.data.agentName, payload });
	};

	const handleBackupFailed = (ws: Bun.ServerWebSocket<AgentConnectionData>, payload: BackupFailedPayload) => {
		getBackupHandlers().onBackupFailed?.({ agentId: ws.data.agentId, agentName: ws.data.agentName, payload });
	};

	const handleBackupCancelled = (ws: Bun.ServerWebSocket<AgentConnectionData>, payload: BackupCancelledPayload) => {
		getBackupHandlers().onBackupCancelled?.({ agentId: ws.data.agentId, agentName: ws.data.agentName, payload });
	};

	const acquireServer = Effect.acquireRelease(
		Effect.sync(() =>
			Bun.serve<AgentConnectionData>({
				port: 3001,
				async fetch(req, srv) {
					const url = new URL(req.url);
					const token = url.searchParams.get("token");

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
						},
					});
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				},
				websocket: {
					open: (ws) => {
						setSession(
							ws.data.agentId,
							createControllerAgentSession(ws, {
								onBackupStarted: (payload) => handleBackupStarted(ws, payload),
								onBackupProgress: (payload) => handleBackupProgress(ws, payload),
								onBackupCompleted: (payload) => handleBackupCompleted(ws, payload),
								onBackupFailed: (payload) => handleBackupFailed(ws, payload),
								onBackupCancelled: (payload) => handleBackupCancelled(ws, payload),
							}),
						);
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

						session.handleMessage(data);
					},
					close: (ws) => {
						removeSession(ws.data.agentId, ws.data.id);
						logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) disconnected`);
					},
				},
			}),
		),
		(server) =>
			Effect.sync(() => {
				closeAllSessions();
				void server.stop(true);
			}),
	);

	const stop = () => {
		if (!runtimeScope) {
			return;
		}

		logger.info("Stopping Agent Manager...");
		const scope = runtimeScope;
		runtimeScope = null;
		Effect.runSync(Scope.close(scope, Exit.succeed(undefined)));
	};

	const start = () => {
		if (runtimeScope) {
			stop();
		}

		logger.info("Starting Agent Manager...");
		const scope = Effect.runSync(Scope.make());

		try {
			const server = Effect.runSync(Scope.extend(acquireServer, scope));
			runtimeScope = scope;
			logger.info(`Agent Manager listening on port ${server.port}`);
		} catch (error) {
			Effect.runSync(Scope.close(scope, Exit.fail(error)));
			throw error;
		}
	};

	return {
		start,
		sendBackup: (agentId: string, payload: BackupRunPayload) => {
			const session = getSession(agentId);

			if (!session) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is not connected.`);
				return false;
			}

			if (!session.isReady()) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is not ready.`);
				return false;
			}

			const jobId = session.sendBackup(payload);
			logger.info(`Sent backup command ${jobId} to agent ${agentId} for schedule ${payload.scheduleId}`);
			return true;
		},
		cancelBackup: (agentId: string, payload: BackupCancelPayload) => {
			const session = getSession(agentId);

			if (!session) {
				logger.warn(`Cannot cancel backup command. Agent ${agentId} is not connected.`);
				return false;
			}

			session.sendBackupCancel(payload);
			logger.info(`Sent backup cancel for command ${payload.jobId} to agent ${agentId}`);
			return true;
		},
		setBackupEventHandlers: (handlers: AgentBackupEventHandlers) => {
			setBackupHandlers(handlers);
		},
		getBackupEventHandlers: () => getBackupHandlers(),
		stop,
	};
};

export const agentManager = getAgentManagerRuntime();

export const stopAgentRuntime = async () => {
	getAgentManagerRuntime().stop();
	await stopLocalAgent();
};
