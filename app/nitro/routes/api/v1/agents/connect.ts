import { defineWebSocketHandler } from "nitro";
import { getAgentController } from "../../../../../server/modules/agents/agents-manager";
import type { AgentConnectionData } from "../../../../../server/modules/agents/controller/connection";
import { authorizeRemoteAgentUpgrade, isSecureAgentRequest } from "../../../../../server/modules/agents/helpers/auth";

const getConnectionData = (peer: { context: unknown }) => peer.context as AgentConnectionData;

export default defineWebSocketHandler({
	async upgrade(request) {
		if (!getAgentController().isRunning()) throw new Response("Agent controller unavailable", { status: 503 });

		const identity = await authorizeRemoteAgentUpgrade(request);
		if (identity instanceof Response) throw identity;

		return {
			context: {
				...identity,
				id: Bun.randomUUIDv7(),
				connectionSecurity: isSecureAgentRequest(request) ? "secure" : "insecure",
			} satisfies AgentConnectionData,
		};
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
