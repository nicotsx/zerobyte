const RESERVED_SSO_PROVIDER_IDS = new Set(["credential"]);

function normalizeSsoProviderId(providerId: string): string {
	return providerId.trim().toLowerCase();
}

export function isReservedSsoProviderId(providerId: string): boolean {
	return RESERVED_SSO_PROVIDER_IDS.has(normalizeSsoProviderId(providerId));
}
