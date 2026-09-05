import type { AgentConnectionData, ControllerTransport } from "./session";
import { config } from "../../../core/config";
import { validateRemoteAgentToken, validateAgentToken } from "../helpers/tokens";

type AgentControllerListenerPorts = {
	isRunning: () => boolean;
	onOpen: (data: AgentConnectionData, transport: ControllerTransport) => Promise<void>;
	onMessage: (data: AgentConnectionData, text: string) => Promise<void>;
	onClose: (data: AgentConnectionData) => Promise<void>;
};

export const createAgentControllerListener = (ports: AgentControllerListenerPorts) =>
	Bun.serve<AgentConnectionData>({
		hostname: "127.0.0.1",
		port: config.environment === "development" ? Number(process.env.ZEROBYTE_DEV_AGENT_PORT ?? 0) : 0,
		async fetch(request, server) {
			if (!ports.isRunning()) return new Response("Controller is stopping", { status: 503 });
			const authorization = request.headers.get("authorization") ?? "";
			const match = /^Bearer ([^\s]+)$/.exec(authorization);
			if (!match) return new Response("Missing token", { status: 401 });
			const token = match[1] ?? "";
			const remoteDevelopmentConnection =
				config.environment === "development" && new URL(request.url).pathname === "/api/v1/agents/connect";
			const authenticated = await (remoteDevelopmentConnection ? validateRemoteAgentToken : validateAgentToken)(
				token,
			);
			if (!authenticated) return new Response("Invalid or revoked token", { status: 401 });
			if (!ports.isRunning()) return new Response("Controller is stopping", { status: 503 });
			const connectionId = Bun.randomUUIDv7();
			const data = { id: connectionId, ...authenticated };
			const upgraded = server.upgrade(request, { data });
			return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
		},
		websocket: {
			open: async (socket) => {
				const transport = {
					send: (message: string) => socket.send(message),
					close: (code?: number, reason?: string) => socket.close(code, reason),
				};
				await ports.onOpen(socket.data, transport);
			},
			message: async (socket, message) => {
				if (typeof message === "string") {
					await ports.onMessage(socket.data, message);
					return;
				}
				socket.close(1003, "text_messages_only");
			},
			close: async (socket) => ports.onClose(socket.data),
		},
	});
