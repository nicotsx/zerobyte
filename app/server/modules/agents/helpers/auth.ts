import { config } from "../../../core/config";
import { serverHasRuntimeFeature } from "../../../lib/permission-service";
import { REMOTE_AGENTS_UNAVAILABLE } from "../constants";
import { validateRemoteAgentToken, type AgentIdentity } from "./tokens";

export const REMOTE_AGENT_CONNECT_PATH = "/api/v1/agents/connect";

export const getAgentBearerToken = (request: Request) =>
	/^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;

export const isSecureAgentRequest = (request: Request) => {
	if (config.environment === "development") return true;

	const protocol = new URL(request.url).protocol;
	const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

	return protocol === "https:" || protocol === "wss:" || (config.trustProxy && forwardedProtocol === "https");
};

export const authorizeRemoteAgentUpgrade = async (request: Request): Promise<AgentIdentity | Response> => {
	if (!serverHasRuntimeFeature("remoteAgents")) return new Response(REMOTE_AGENTS_UNAVAILABLE, { status: 503 });
	if (!isSecureAgentRequest(request)) return new Response("TLS required", { status: 426 });

	const token = getAgentBearerToken(request);
	const identity = token ? await validateRemoteAgentToken(token) : null;

	return identity ?? new Response("Unauthorized", { status: 401 });
};
