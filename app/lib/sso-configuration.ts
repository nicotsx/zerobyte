import { z } from "zod";

export const ssoUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
	const url = URL.parse(value);
	return url !== null && !url.username && !url.password && !url.hash;
}, "Enter an HTTP or HTTPS URL without credentials or a fragment.");

export const updateSsoProviderBody = z
	.object({
		issuer: ssoUrlSchema,
		domain: z.string().trim().min(1),
		discoveryEndpoint: ssoUrlSchema,
		clientId: z.string().min(1),
		clientSecret: z.string().min(1),
	})
	.partial()
	.strict();

export const ssoDiscoveryResultSchema = z.object({
	discoveryStatus: z.enum(["ok", "issuer_mismatch", "unavailable"]),
	discoveryIssuer: z.string().nullable(),
	discoveryMessage: z.string().nullable(),
});

export const ssoProviderDetailsSchema = z.object({
	providerId: z.string(),
	issuer: z.string(),
	domain: z.string(),
	clientId: z.string(),
	discoveryEndpoint: z.string(),
	hasClientSecret: z.boolean(),
	hasLinkedAccounts: z.boolean(),
	callbackUrl: z.string(),
	expectedCallbackUrl: z.string().nullable(),
	proxyMisconfigured: z.boolean(),
});

export type SsoProviderDetails = z.infer<typeof ssoProviderDetailsSchema>;
export type SsoDiscoveryResult = z.infer<typeof ssoDiscoveryResultSchema>;
export type UpdateSsoProviderBody = z.infer<typeof updateSsoProviderBody>;
