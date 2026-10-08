import { config } from "../../../core/config";

export const getAgentBearerToken = (request: Request) =>
	/^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;

export const isSecureAgentRequest = (request: Request) => {
	const protocol = new URL(request.url).protocol;
	const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();

	return protocol === "https:" || protocol === "wss:" || (config.trustProxy && forwardedProtocol === "https");
};
