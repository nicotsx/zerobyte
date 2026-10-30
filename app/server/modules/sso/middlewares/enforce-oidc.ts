import { APIError } from "better-auth/api";
import type { AuthMiddlewareContext } from "~/server/lib/auth";

export const enforceOidcSso = async (ctx: AuthMiddlewareContext) => {
	if (ctx.path.startsWith("/sso/saml2/")) {
		throw new APIError("NOT_FOUND", { message: "SAML is not supported" });
	}

	const body = ctx.body as Record<string, unknown> | undefined;
	if (!body) return;

	if ((ctx.path === "/sso/register" || ctx.path === "/sso/update-provider") && body.samlConfig !== undefined) {
		throw new APIError("BAD_REQUEST", { message: "Only OIDC SSO providers are supported" });
	}

	if (ctx.path === "/sign-in/sso") {
		if (body.providerType !== undefined && body.providerType !== "oidc") {
			throw new APIError("BAD_REQUEST", { message: "Only OIDC SSO providers are supported" });
		}

		body.providerType = "oidc";
	}
};
