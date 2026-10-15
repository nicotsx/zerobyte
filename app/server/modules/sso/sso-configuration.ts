import { computeDiscoveryUrl, discoverOIDCConfig, DiscoveryError, type HydratedOIDCConfig } from "@better-auth/sso";
import { BadRequestError, ConflictError, NotFoundError } from "http-errors-enhanced";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { SsoDiscoveryResult, UpdateSsoProviderBody } from "~/lib/sso-configuration";
import { getLinkedSsoProviderEditError, isSameIssuerExceptTrailingSlash } from "~/lib/sso-provider-identity";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { ssoProvider } from "~/server/db/schema";
import { resolveAuthBaseURL } from "~/server/lib/auth/request-base-url";

type IsTrustedOrigin = (url: string) => boolean;

const editableOidcConfigSchema = z.looseObject({
	clientId: z.string(),
	clientSecret: z.string().optional(),
	discoveryEndpoint: z.string().optional(),
});

export async function checkSsoDiscovery(
	issuer: string,
	discoveryEndpoint: string | undefined,
	isTrustedOrigin: IsTrustedOrigin,
): Promise<SsoDiscoveryResult> {
	let discoveryIssuer: string;

	try {
		const discovered = await discoverOIDCConfig({ issuer, discoveryEndpoint, isTrustedOrigin, timeout: 5000 });
		discoveryIssuer = discovered.issuer;
	} catch (error) {
		if (!(error instanceof DiscoveryError)) throw error;
		if (error.code !== "issuer_mismatch" || typeof error.details?.discovered !== "string") {
			return { discoveryStatus: "unavailable", discoveryIssuer: null, discoveryMessage: error.message };
		}

		discoveryIssuer = error.details.discovered;
	}

	const matches = discoveryIssuer === issuer;

	return {
		discoveryStatus: matches ? "ok" : "issuer_mismatch",
		discoveryIssuer,
		discoveryMessage: matches ? null : "The issuer must match discovery exactly, including any trailing slash.",
	};
}

export function getSsoCallbackDiagnostics(request: Request, providerId: string) {
	const callbackUrl = `${resolveAuthBaseURL(request)}/sso/callback/${providerId}`;
	const callback = new URL(callbackUrl);
	const requestOrigin = URL.parse(request.headers.get("origin") ?? "");
	let publicOrigin = new URL(config.baseUrl);

	if (requestOrigin) {
		const trusted = config.trustedOrigins.some((origin) => URL.parse(origin)?.origin === requestOrigin.origin);
		if (trusted) publicOrigin = requestOrigin;
	}

	let expectedCallbackUrl: string | null = null;
	if (callback.protocol === "http:" && publicOrigin.protocol === "https:" && publicOrigin.host === callback.host) {
		expectedCallbackUrl = `${publicOrigin.origin}${callback.pathname}`;
	}

	return { callbackUrl, expectedCallbackUrl, proxyMisconfigured: expectedCallbackUrl !== null };
}

function findProvider(providerId: string, organizationId: string, query = db.query) {
	const provider = query.ssoProvider.findFirst({ where: { providerId, organizationId } }).sync();
	if (!provider) throw new NotFoundError("Provider not found");
	if (!provider.oidcConfig || provider.samlConfig) {
		throw new BadRequestError("Only OIDC providers can be edited here.");
	}

	return { ...provider, oidcConfig: editableOidcConfigSchema.parse(provider.oidcConfig) };
}

export function getSsoProviderDetails(providerId: string, organizationId: string, request: Request) {
	const provider = findProvider(providerId, organizationId);
	const oidc = provider.oidcConfig;
	const linkedAccount = db.query.account.findFirst({ where: { providerId }, columns: { id: true } }).sync();

	return {
		providerId,
		issuer: provider.issuer,
		domain: provider.domain,
		clientId: oidc.clientId,
		discoveryEndpoint: oidc.discoveryEndpoint ?? computeDiscoveryUrl(provider.issuer),
		hasClientSecret: !!oidc.clientSecret,
		hasLinkedAccounts: !!linkedAccount,
		...getSsoCallbackDiagnostics(request, providerId),
	};
}

export function checkSsoProviderDiscovery(
	providerId: string,
	organizationId: string,
	isTrustedOrigin: IsTrustedOrigin,
) {
	const provider = findProvider(providerId, organizationId);
	return checkSsoDiscovery(provider.issuer, provider.oidcConfig.discoveryEndpoint, isTrustedOrigin);
}

export async function updateSsoProvider(
	providerId: string,
	organizationId: string,
	input: UpdateSsoProviderBody,
	isTrustedOrigin: IsTrustedOrigin,
) {
	let discovered: HydratedOIDCConfig | undefined;

	if (input.issuer !== undefined || input.discoveryEndpoint !== undefined || input.clientId !== undefined) {
		const provider = findProvider(providerId, organizationId);

		try {
			discovered = await discoverOIDCConfig({
				issuer: input.issuer ?? provider.issuer,
				discoveryEndpoint: input.discoveryEndpoint ?? provider.oidcConfig.discoveryEndpoint,
				isTrustedOrigin,
				timeout: 5000,
			});
		} catch (error) {
			if (error instanceof DiscoveryError) throw new BadRequestError(error.message);
			throw error;
		}
	}

	return db.transaction((tx) => {
		const provider = findProvider(providerId, organizationId, tx.query);
		const oidc = provider.oidcConfig;
		const issuer = input.issuer ?? provider.issuer;
		const discoveryEndpoint = input.discoveryEndpoint ?? oidc.discoveryEndpoint ?? computeDiscoveryUrl(issuer);
		const linkedAccount = tx.query.account.findFirst({ where: { providerId }, columns: { id: true } }).sync();
		const identityError = getLinkedSsoProviderEditError({ ...oidc, issuer: provider.issuer }, input);
		if (linkedAccount && identityError) throw new ConflictError(identityError);

		if (discovered && discovered.issuer !== issuer) {
			throw new BadRequestError(
				`Issuer mismatch. Use exactly ${discovered.issuer}, including its trailing slash.`,
			);
		}
		if (discovered && discovered.discoveryEndpoint !== discoveryEndpoint) {
			throw new ConflictError("The discovery endpoint changed. Try again.");
		}

		const discoveryChanged = discoveryEndpoint !== (oidc.discoveryEndpoint ?? computeDiscoveryUrl(provider.issuer));
		const issuerAuthorityChanged = !isSameIssuerExceptTrailingSlash(provider.issuer, issuer);
		const refreshedConfig = discoveryChanged || issuerAuthorityChanged ? discovered : undefined;
		const { domain, ...oidcChanges } = input;

		tx.update(ssoProvider)
			.set({
				issuer,
				domain: domain ?? provider.domain,
				oidcConfig: { ...oidc, ...refreshedConfig, ...oidcChanges, issuer },
			})
			.where(eq(ssoProvider.id, provider.id))
			.run();
	});
}
