import { spawn } from "node:child_process";
import path from "node:path";
import {
	createControllerMessage,
	parseAgentMessage,
	sendControllerMessage,
	type BackupCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { validateAgentToken, deriveLocalAgentToken } from "./agent-tokens";

type AgentConnectionData = {
	id: string;
	agentId: string;
	organizationId: string | null;
	agentName: string;
};

type AgentSocket = Bun.ServerWebSocket<AgentConnectionData>;
type AgentServer = ReturnType<typeof Bun.serve<AgentConnectionData>>;
const AGENT_SERVER_KEY = Symbol.for("zerobyte.agent-manager.server");
const AGENT_SOCKETS_KEY = Symbol.for("zerobyte.agent-manager.sockets");

const globalState = globalThis as typeof globalThis & {
	[AGENT_SERVER_KEY]?: AgentServer;
	[AGENT_SOCKETS_KEY]?: Map<string, AgentSocket>;
};

const getServer = () => globalState[AGENT_SERVER_KEY] ?? null;
const getAgentSockets = () => {
	globalState[AGENT_SOCKETS_KEY] ??= new Map<string, AgentSocket>();
	return globalState[AGENT_SOCKETS_KEY];
};
const clearAgentSockets = () => {
	getAgentSockets().clear();
};

const setServer = (server: AgentServer | null) => {
	if (server) {
		globalState[AGENT_SERVER_KEY] = server;
		return;
	}

	delete globalState[AGENT_SERVER_KEY];
};

export const spawnLocalAgent = async () => {
	const agentEntryPoint = path.join(process.cwd(), "apps", "agent", "src", "index.ts");
	const agentToken = await deriveLocalAgentToken();

	const localAgent = spawn("bun", ["run", agentEntryPoint], {
		env: {
			PATH: process.env.PATH,
			ZEROBYTE_CONTROLLER_URL: "ws://localhost:3001",
			ZEROBYTE_AGENT_TOKEN: agentToken,
		},
		stdio: ["ignore", "pipe", "pipe"],
	});

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

export const agentManager = {
	start: () => {
		const existingServer = getServer();
		if (existingServer) {
			existingServer.stop(true);
			setServer(null);
			clearAgentSockets();
		}

		logger.info("Starting Agent Manager...");
		const server = Bun.serve<AgentConnectionData>({
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
					getAgentSockets().set(ws.data.agentId, ws);
					logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) connected on ${ws.data.id}`);
				},
				message: (ws, data) => {
					if (typeof data !== "string") {
						logger.warn(`Ignoring non-text message from agent ${ws.data.agentId}`);
						return;
					}

					const parsed = parseAgentMessage(data);

					if (parsed === null) {
						logger.warn(`Invalid JSON from agent ${ws.data.agentId}`);
						return;
					}

					if (!parsed.success) {
						logger.warn(`Invalid agent message from ${ws.data.agentId}: ${parsed.error.message}`);
						return;
					}

					switch (parsed.data.type) {
						case "agent.ready": {
							logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) is ready`);
							break;
						}
						case "backup.started": {
							logger.info(`Backup started on agent ${ws.data.agentId} for schedule ${parsed.data.payload.scheduleId}`);
							break;
						}
					}
				},
				close: (ws) => {
					if (getAgentSockets().get(ws.data.agentId) === ws) {
						getAgentSockets().delete(ws.data.agentId);
					}

					logger.info(`Agent "${ws.data.agentName}" (${ws.data.agentId}) disconnected`);
				},
			},
		});

		setServer(server);
		logger.info(`Agent Manager listening on port ${server.port}`);
	},
	sendBackup: (agentId: string, payload: BackupCommandPayload) => {
		const agentSocket = getAgentSockets().get(agentId);

		if (!agentSocket) {
			logger.warn(`Cannot send backup command. Agent ${agentId} is not connected.`);
			return false;
		}

		sendControllerMessage(agentSocket, createControllerMessage("backup", payload));
		logger.info(`Sent backup command to agent ${agentId} for schedule ${payload.scheduleId}`);
		return true;
	},
	stop: () => {
		const server = getServer();
		if (!server) return;

		logger.info("Stopping Agent Manager...");
		server.stop(true);
		setServer(null);
		clearAgentSockets();
	},
};
