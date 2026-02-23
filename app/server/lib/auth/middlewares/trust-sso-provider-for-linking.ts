import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { extractProviderIdFromContext } from "../utils/sso-context";

export function isSsoCallbackPath(path?: string): boolean {
	if (!path) {
		return false;
	}

	return path.startsWith("/sso/callback/");
}

export async function trustSsoProviderForLinking(ctx: GenericEndpointContext): Promise<void> {
	const providerId = extractProviderIdFromContext(ctx);

	if (!providerId) {
		return;
	}

	const accountLinking = ctx.context.options.account?.accountLinking;

	if (!accountLinking || accountLinking.enabled === false) {
		return;
	}

	const provider = await db.query.ssoProvider.findFirst({
		columns: { organizationId: true },
		where: { providerId },
	});
	if (!provider) {
		return;
	}

	const autoLinkingProviders = await db.query.ssoProvider.findMany({
		columns: { providerId: true },
		where: {
			organizationId: provider.organizationId,
			autoLinkMatchingEmails: true,
		},
	});

	accountLinking.trustedProviders = autoLinkingProviders.map((entry) => entry.providerId);
}
