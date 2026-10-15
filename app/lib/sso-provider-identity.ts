type SsoProviderIdentity = {
	issuer: string;
	clientId: string;
	discoveryEndpoint?: string;
};

type SsoProviderIdentityUpdate = {
	issuer?: string;
	clientId?: string;
	discoveryEndpoint?: string;
};

export function isSameIssuerExceptTrailingSlash(currentIssuer: string, nextIssuer: string) {
	const currentWithoutSlash = currentIssuer.replace(/\/$/, "");
	const nextWithoutSlash = nextIssuer.replace(/\/$/, "");

	return currentWithoutSlash === nextWithoutSlash;
}

export function getLinkedSsoProviderEditError(
	provider: SsoProviderIdentity,
	update: SsoProviderIdentityUpdate,
): string | null {
	if (update.clientId !== undefined && update.clientId !== provider.clientId) {
		return "This provider has linked accounts. Its client ID cannot be changed.";
	}

	if (update.discoveryEndpoint !== undefined && update.discoveryEndpoint !== provider.discoveryEndpoint) {
		return "This provider has linked accounts. Its discovery endpoint cannot be changed.";
	}

	if (update.issuer !== undefined && !isSameIssuerExceptTrailingSlash(provider.issuer, update.issuer)) {
		return "This provider has linked accounts. Only a discovery-confirmed trailing-slash correction can change its issuer.";
	}

	return null;
}
