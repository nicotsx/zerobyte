import { db } from "~/server/db/db";
import { extractProviderIdFromUrl } from "../utils/sso-context";

export async function resolveTrustedProvidersForRequest(request?: Request): Promise<string[]> {
	if (!request) {
		return [];
	}

	const providerId = extractProviderIdFromUrl(request.url);
	if (!providerId) {
		return [];
	}

	const provider = await db.query.ssoProvider.findFirst({
		columns: { organizationId: true },
		where: { providerId },
	});
	if (!provider) {
		return [];
	}

	const autoLinkingProviders = await db.query.ssoProvider.findMany({
		columns: { providerId: true },
		where: {
			organizationId: provider.organizationId,
			autoLinkMatchingEmails: true,
		},
	});

	return autoLinkingProviders.map((entry) => entry.providerId);
}
