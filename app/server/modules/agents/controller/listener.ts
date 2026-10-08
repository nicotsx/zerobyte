import type { AgentConnectionData, ControllerTransport } from "./connection";
import { config } from "../../../core/config";
import { validateLocalAgentToken } from "../helpers/tokens";
import { authorizeRemoteAgentUpgrade, getAgentBearerToken, REMOTE_AGENT_CONNECT_PATH } from "../helpers/auth";

type AgentControllerListenerPorts = {
	isRunning: () => boolean;
	socket: {
		open: (data: AgentConnectionData, transport: ControllerTransport) => Promise<void>;
		message: (data: AgentConnectionData, transport: ControllerTransport, text: string | null) => Promise<void>;
		close: (data: AgentConnectionData) => Promise<void>;
	};
};

const authorizeLocalAgentUpgrade = async (request: Request) => {
	const token = getAgentBearerToken(request);
	if (!token) return new Response("Missing token", { status: 401 });

	return (await validateLocalAgentToken(token)) ?? new Response("Invalid or revoked token", { status: 401 });
};

// In development, Vite proxies remote agent connections to this listener instead of the Nitro websocket route.
const isProxiedRemoteAgentRequest = (request: Request) =>
	config.environment === "development" && new URL(request.url).pathname === REMOTE_AGENT_CONNECT_PATH;

export const createAgentControllerListener = ({ isRunning, socket }: AgentControllerListenerPorts) =>
	Bun.serve<AgentConnectionData>({
		hostname: "127.0.0.1",
		port: config.devAgentPort,
		async fetch(request, server) {
			if (!isRunning()) return new Response("Controller is stopping", { status: 503 });

			let identity;
			if (isProxiedRemoteAgentRequest(request)) {
				identity = await authorizeRemoteAgentUpgrade(request);
			} else {
				identity = await authorizeLocalAgentUpgrade(request);
			}

			if (identity instanceof Response) return identity;
			if (!isRunning()) return new Response("Controller is stopping", { status: 503 });

			const upgraded = server.upgrade(request, { data: { ...identity, id: Bun.randomUUIDv7() } });

			return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
		},
		websocket: {
			open: (ws) => socket.open(ws.data, ws),
			message: (ws, message) => socket.message(ws.data, ws, typeof message === "string" ? message : null),
			close: (ws) => socket.close(ws.data),
		},
	});
