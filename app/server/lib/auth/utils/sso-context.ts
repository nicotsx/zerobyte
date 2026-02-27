import type { GenericEndpointContext } from "@better-auth/core";

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function extractProviderIdFromUrl(url: string): string | null {
	try {
		const pathname = new URL(url, "http://localhost").pathname;
		const match = pathname.match(/\/sso\/(?:saml2\/)?callback\/([^/]+)$/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

export function extractProviderIdFromContext(ctx?: GenericEndpointContext | null) {
	if (!ctx) {
		return null;
	}

	if (ctx.params?.providerId) {
		return ctx.params.providerId;
	}

	if (ctx.request?.url) {
		return extractProviderIdFromUrl(ctx.request.url);
	}

	return null;
}
