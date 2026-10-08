import type { AgentConnectionData, ControllerTransport } from "./connection";
import { validateLocalAgentToken } from "../helpers/tokens";
import { getAgentBearerToken } from "../helpers/auth";

type AgentControllerListenerPorts = {
	isRunning: () => boolean;
	socket: {
		open: (data: AgentConnectionData, transport: ControllerTransport) => Promise<void>;
		message: (data: AgentConnectionData, transport: ControllerTransport, text: string | null) => Promise<void>;
		close: (data: AgentConnectionData) => Promise<void>;
	};
};

export const createAgentControllerListener = ({ isRunning, socket }: AgentControllerListenerPorts) =>
	Bun.serve<AgentConnectionData>({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request, server) {
			if (!isRunning()) return new Response("Controller is stopping", { status: 503 });

			const token = getAgentBearerToken(request);

			if (!token) return new Response("Missing token", { status: 401 });

			const identity = await validateLocalAgentToken(token);

			if (!identity) return new Response("Invalid or revoked token", { status: 401 });
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
