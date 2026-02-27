import { APIError } from "better-auth/api";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { isReservedSsoProviderId } from "../utils/sso-provider-id";

export const validateSsoProviderId = async (ctx: AuthMiddlewareContext) => {
	if (ctx.path !== "/sso/register") {
		return;
	}

	if (!ctx.body || typeof ctx.body !== "object") {
		return;
	}

	const providerId = (ctx.body as Record<string, unknown>).providerId;

	if (typeof providerId !== "string") {
		return;
	}

	if (isReservedSsoProviderId(providerId)) {
		throw new APIError("BAD_REQUEST", {
			message: `Invalid providerId. '${providerId}' is reserved and cannot be used for SSO providers.`,
		});
	}
};
