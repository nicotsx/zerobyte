import { APIError } from "better-auth/api";
import type { AuthMiddlewareContext } from "~/server/lib/auth";

function isValidCallbackPath(value: string): boolean {
	if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
		return false;
	}

	if (value.startsWith("/sso/callback/") || value.startsWith("/sso/saml2/")) {
		return false;
	}

	return true;
}

export const validateSsoCallbackUrls = async (ctx: AuthMiddlewareContext) => {
	if (ctx.path !== "/sign-in/sso") {
		return;
	}

	const sources = [ctx.body, ctx.query].filter((s) => s && typeof s === "object");

	for (const source of sources) {
		const payload = source as Record<string, unknown>;

		for (const field of ["callbackURL", "errorCallbackURL", "newUserCallbackURL"]) {
			const value = payload[field];

			if (value !== undefined && (typeof value !== "string" || !isValidCallbackPath(value))) {
				throw new APIError("BAD_REQUEST", {
					message: `Invalid ${field}. Only relative paths like /login are allowed.`,
					code: `INVALID_${field.toUpperCase()}`,
				});
			}
		}
	}
};
