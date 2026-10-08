import { defineWebSocketHandler } from "nitro";
import { serverHasRuntimeFeature } from "../../../../../server/lib/permission-service";
import { getAgentController } from "../../../../../server/modules/agents/agents-manager";
import { REMOTE_AGENTS_UNAVAILABLE } from "../../../../../server/modules/agents/constants";
import { validateRemoteAgentToken } from "../../../../../server/modules/agents/helpers/tokens";
import type { AgentConnectionData } from "../../../../../server/modules/agents/controller/connection";
import { getAgentBearerToken, isSecureAgentRequest } from "../../../../../server/modules/agents/helpers/auth";

const getConnectionData = (peer: { context: unknown }) => peer.context as AgentConnectionData;

export default defineWebSocketHandler({
	async upgrade(request) {
		if (!serverHasRuntimeFeature("remoteAgents")) throw new Response(REMOTE_AGENTS_UNAVAILABLE, { status: 503 });
		if (!getAgentController().isRunning()) throw new Response("Agent controller unavailable", { status: 503 });
		if (!isSecureAgentRequest(request)) throw new Response("TLS required", { status: 426 });

		const token = getAgentBearerToken(request);
		const identity = token ? await validateRemoteAgentToken(token) : null;

		if (!identity) throw new Response("Unauthorized", { status: 401 });

		return { context: { ...identity, id: Bun.randomUUIDv7() } satisfies AgentConnectionData };
	},
	open: (peer) => getAgentController().socket.open(getConnectionData(peer), peer),
	message: (peer, message) =>
		getAgentController().socket.message(
			getConnectionData(peer),
			peer,
			typeof message.rawData === "string" ? message.text() : null,
		),
	close: (peer) => getAgentController().socket.close(getConnectionData(peer)),
});
