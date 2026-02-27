import type { GenericEndpointContext } from "better-auth";

const SSO_CALLBACK_PATH_PATTERN = /\/sso\/(?:callback|saml2\/callback|saml2\/sp\/acs)\/([^/]+)$/;

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function extractProviderIdFromPath(path: string): string | null {
	const match = path.match(SSO_CALLBACK_PATH_PATTERN);
	return match?.[1] ?? null;
}

export function extractProviderIdFromUrl(url: string): string | null {
	try {
		const pathname = new URL(url, "http://localhost").pathname;
		return extractProviderIdFromPath(pathname);
	} catch {
		return null;
	}
}

export function isSsoCallbackPath(path?: string | null): boolean {
	if (!path) {
		return false;
	}

	return extractProviderIdFromPath(path) !== null;
}

export function isSsoCallbackRequest(ctx?: GenericEndpointContext | null): boolean {
	if (!ctx?.request?.url) {
		return false;
	}

	return extractProviderIdFromUrl(ctx.request.url) !== null;
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
