import { defineWebSocketHandler } from "nitro";
import { config } from "../../../../../server/core/config";
import { getAgentManagerRuntime } from "../../../../../server/modules/agents/agents-manager";
import { agentsService } from "../../../../../server/modules/agents/agents.service";
import { validateRemoteAgentToken } from "../../../../../server/modules/agents/helpers/tokens";

type RemotePeerContext = {
	connectionId: string;
	agentId: string;
	organizationId: string;
	agentName: string;
	agentKind: "remote";
	credentialVersion: number;
};

const unauthorized = () => new Response("Unauthorized", { status: 401 });

export default defineWebSocketHandler({
	async upgrade(request) {
		if (config.runtime !== "server") throw new Response("Remote agents are unavailable", { status: 503 });
		if (!getAgentManagerRuntime()) throw new Response("Agent controller unavailable", { status: 503 });

		const url = new URL(request.url);
		const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
		const trustedForwardedHttps = config.trustProxy && forwardedProtocol === "https";
		const secure = url.protocol === "https:" || url.protocol === "wss:" || trustedForwardedHttps;

		if (config.__prod__ && !secure) throw new Response("TLS required", { status: 426 });

		const authorization = request.headers.get("authorization") ?? "";
		const match = /^Bearer ([^\s]+)$/.exec(authorization);

		if (!match) throw unauthorized();

		const token = match[1] ?? "";
		const authenticated = await validateRemoteAgentToken(token);

		if (!authenticated || !authenticated.organizationId || authenticated.agentKind !== "remote")
			throw unauthorized();

		const context: RemotePeerContext = {
			connectionId: Bun.randomUUIDv7(),
			agentId: authenticated.agentId,
			organizationId: authenticated.organizationId,
			agentName: authenticated.agentName,
			agentKind: "remote",
			credentialVersion: authenticated.credentialVersion,
		};

		return { context };
	},
	async open(peer) {
		const context = peer.context as RemotePeerContext;
		const runtime = getAgentManagerRuntime();

		if (!runtime) {
			try {
				peer.close(1013, "controller_unavailable");
			} catch {
				// The transport is already unavailable.
			}
			return;
		}

		const connection = { ...context, id: context.connectionId };
		const transport = {
			send: (message: string) => peer.send(message),
			close: (code?: number, reason?: string) => peer.close(code, reason),
		};

		let promoted = false;

		try {
			runtime.beginOpeningConnection(connection, transport);

			const agent = await agentsService.getAgent(context.agentId);
			const stillValid =
				agent &&
				agent.kind === "remote" &&
				agent.organizationId === context.organizationId &&
				agent.credentialVersion === context.credentialVersion &&
				agent.revokedAt === null &&
				Boolean(agent.credentialHash);

			if (!stillValid) {
				await runtime.rejectOpeningConnection(context.agentId, context.connectionId, "credential_changed");
				return;
			}

			const promotionResult = await runtime.promoteOpeningConnection(context.agentId, context.connectionId);
			promoted = promotionResult === true;

			if (promoted) return;

			await runtime.rejectOpeningConnection(context.agentId, context.connectionId, "connection_replaced");

			try {
				peer.close(1000, "connection_replaced");
			} catch {
				// Cleanup is owned by the runtime once the provisional identity is rejected.
			}
		} catch {
			if (promoted) return;
			try {
				await runtime.rejectOpeningConnection(context.agentId, context.connectionId, "promotion_failed");
			} catch {
				// Continue closing the peer even if runtime cleanup itself failed.
			}
			try {
				peer.close(1011, "promotion_failed");
			} catch {
				// The provisional runtime identity has already been rejected.
			}
		}
	},
	async message(peer, message) {
		const context = peer.context as RemotePeerContext;

		if (typeof message.rawData !== "string") return peer.close(1003, "text_messages_only");

		const runtime = getAgentManagerRuntime();

		if (!runtime) return peer.close(1013, "controller_unavailable");

		const text = message.text();
		await runtime.handleConnectionMessage(context.agentId, context.connectionId, text);
	},
	async close(peer) {
		const context = peer.context as RemotePeerContext;
		const runtime = getAgentManagerRuntime();
		if (runtime) await runtime.closeConnection(context.agentId, context.connectionId);
	},
});
