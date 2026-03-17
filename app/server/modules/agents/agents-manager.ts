import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { Effect, Exit, Ref, Scope } from "effect";
import { logger } from "@zerobyte/core/node";
import { config } from "../../core/config";
import { validateAgentToken, deriveLocalAgentToken } from "./agent-tokens";
import {
	createControllerAgentSession,
	type BackupDispatchPayload,
	type ControllerAgentSession,
} from "./controller-agent-session";

type AgentConnectionData = {
	id: string;
	agentId: string;
	organizationId: string | null;
	agentName: string;
};

export const spawnLocalAgent = async () => {
	const previousAgent = (globalThis as Record<string, unknown>).__localAgent as ChildProcess | undefined;
	if (previousAgent) {
		previousAgent.kill();
	}

	const agentEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
	const agentToken = await deriveLocalAgentToken();
	const args = config.__prod__ ? ["run", agentEntryPoint] : ["run", "--watch", agentEntryPoint];

	const localAgent = spawn("bun", args, {
		env: {
			PATH: process.env.PATH,
			ZEROBYTE_CONTROLLER_URL: "ws://localhost:3001",
			ZEROBYTE_AGENT_TOKEN: agentToken,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

	(globalThis as Record<string, unknown>).__localAgent = localAgent;

	localAgent.stdout?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.info(`[agent] ${line}`);
	});

	localAgent.stderr?.on("data", (data: Buffer) => {
		const line = data.toString().trim();
		if (line) logger.error(`[agent] ${line}`);
	});

	localAgent.on("exit", (code, signal) => {
		logger.info(`Agent process exited with code ${code} and signal ${signal}`);
	});
};

const createAgentManagerRuntime = () => {
	const sessionsRef = Effect.runSync(Ref.make<Map<string, ControllerAgentSession>>(new Map()));
	let runtimeScope: Scope.CloseableScope | null = null;

	const getSessions = () => Effect.runSync(Ref.get(sessionsRef));
	const setSessions = (sessions: Map<string, ControllerAgentSession>) => {
		Effect.runSync(Ref.set(sessionsRef, sessions));
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
						setSession(ws.data.agentId, createControllerAgentSession(ws));
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
				server.stop(true);
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
		sendBackup: (agentId: string, payload: BackupDispatchPayload) => {
			const session = getSession(agentId);

			if (!session) {
				logger.warn(`Cannot send backup command. Agent ${agentId} is not connected.`);
				return false;
			}

			const jobId = session.sendBackup(payload);
			logger.info(`Sent backup command ${jobId} to agent ${agentId} for schedule ${payload.scheduleId}`);
			return true;
		},
		stop,
	};
};

const previous = (globalThis as Record<string, unknown>).__agentManager as
	| ReturnType<typeof createAgentManagerRuntime>
	| undefined;

previous?.stop();

export const agentManager = createAgentManagerRuntime();
(globalThis as Record<string, unknown>).__agentManager = agentManager;
