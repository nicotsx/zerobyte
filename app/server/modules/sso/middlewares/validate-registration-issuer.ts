import { APIError } from "better-auth/api";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { checkSsoDiscovery } from "../sso-configuration";

export async function validateSsoRegistrationIssuer(ctx: AuthMiddlewareContext) {
	if (ctx.path !== "/sso/register") return;

	const body = ctx.body as
		{ issuer?: string; oidcConfig?: { discoveryEndpoint?: string; skipDiscovery?: boolean } } | undefined;
	if (!body?.issuer || !body.oidcConfig || body.oidcConfig.skipDiscovery) return;

	const result = await checkSsoDiscovery(body.issuer, body.oidcConfig.discoveryEndpoint, (url) =>
		ctx.context.isTrustedOrigin(url),
	);
	if (result.discoveryStatus === "issuer_mismatch") {
		throw new APIError("BAD_REQUEST", {
			code: "SSO_ISSUER_MISMATCH",
			message: `Issuer mismatch. Use exactly ${result.discoveryIssuer}, including its trailing slash.`,
		});
	}
}
