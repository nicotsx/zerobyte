import { authService } from "~/server/modules/auth/auth.service";
import { extractProviderIdFromUrl } from "../utils/sso-context";

export async function resolveTrustedProvidersForRequest(request?: Request): Promise<string[]> {
	if (!request) {
		return [];
	}

	const providerId = extractProviderIdFromUrl(request.url);
	if (!providerId) {
		return [];
	}

	const provider = await authService.getSsoProviderById(providerId);
	if (!provider) {
		return [];
	}

	return authService.getAutoLinkingSsoProviderIds(provider.organizationId);
}
