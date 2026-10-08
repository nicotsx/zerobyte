export const AGENT_CONNECT_PATH = "/api/v1/agents/connect";

export const toAgentConnectionUrl = (controller: string | URL) => {
	const url = new URL(AGENT_CONNECT_PATH, controller);
	url.protocol = url.protocol === "http:" || url.protocol === "ws:" ? "ws:" : "wss:";

	return url;
};

export const toControllerOrigin = (connectionUrl: string | URL) => {
	const url = new URL(connectionUrl);
	url.protocol = url.protocol === "ws:" || url.protocol === "http:" ? "http:" : "https:";

	return url.origin;
};
