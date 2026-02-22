import type { GenericEndpointContext } from "@better-auth/core";

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function extractProviderIdFromContext(ctx: GenericEndpointContext): string | null {
	if (ctx.params?.providerId) {
		return ctx.params.providerId;
	}

	if (ctx.request?.url) {
		try {
			const pathname = new URL(ctx.request.url, "http://localhost").pathname;
			const ssoCallbackMatch = pathname.match(/\/sso\/(?:saml2\/)?callback\/([^/]+)$/);
			if (ssoCallbackMatch) {
				return ssoCallbackMatch[1];
			}
		} catch {
			return null;
		}
	}

	return null;
}
