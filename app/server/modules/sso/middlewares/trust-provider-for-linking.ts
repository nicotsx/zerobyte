import { ssoService } from "~/server/modules/sso/sso.service";
import { extractProviderIdFromUrl } from "~/server/modules/sso/utils/sso-context";

export async function resolveTrustedProvidersForRequest(request?: Request): Promise<string[]> {
	if (!request) {
		return [];
	}

	const providerId = extractProviderIdFromUrl(request.url);
	if (!providerId) {
		return [];
	}

	const provider = await ssoService.getSsoProviderById(providerId);
	if (!provider) {
		return [];
	}

	return ssoService.getAutoLinkingSsoProviderIds(provider.organizationId);
}
