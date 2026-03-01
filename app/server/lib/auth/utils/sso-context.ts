import type { GenericEndpointContext } from "@better-auth/core";

const SSO_CALLBACK_PATH_SEGMENTS = ["/sso/callback/", "/sso/saml2/callback/", "/sso/saml2/sp/acs/"] as const;

const SSO_CALLBACK_PATH_PATTERN = /\/sso\/(?:callback|saml2\/callback|saml2\/sp\/acs)\/([^/]+)$/;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function isSsoCallbackPath(pathname: string): boolean {
	return SSO_CALLBACK_PATH_SEGMENTS.some((segment) => pathname.includes(segment));
}

export function extractProviderIdFromPathname(pathname: string): string | null {
	if (!isSsoCallbackPath(pathname)) {
		return null;
	}

	const match = pathname.match(SSO_CALLBACK_PATH_PATTERN);
	return match?.[1] ?? null;
}

export function extractProviderIdFromUrl(url: string): string | null {
	try {
		const pathname = new URL(url, "http://localhost").pathname;
		return extractProviderIdFromPathname(pathname);
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
