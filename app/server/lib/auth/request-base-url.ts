import { resolveBaseURL } from "better-auth";
import { config } from "~/server/core/config";

export const authBaseURL = {
	allowedHosts: config.allowedHosts,
	protocol: "auto" as const,
	fallback: config.baseUrl,
};

export function resolveAuthBaseURL(request: Request) {
	return resolveBaseURL(authBaseURL, "/api/auth", request, false, config.trustProxy)!;
}
