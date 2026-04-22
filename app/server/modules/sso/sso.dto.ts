import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";

const publicSsoProvidersDto = z.object({
	providers: z
		.object({
			providerId: z.string(),
			organizationSlug: z.string(),
		})
		.array(),
});

export type PublicSsoProvidersDto = z.infer<typeof publicSsoProvidersDto>;

export const getPublicSsoProvidersDto = describeRoute({
	description: "Get public SSO providers for the instance",
	operationId: "getPublicSsoProviders",
	tags: ["Auth"],
	responses: {
		200: {
			description: "List of public SSO providers",
			content: {
				"application/json": {
					schema: resolver(publicSsoProvidersDto),
				},
			},
		},
	},
});

const ssoSettingsResponse = z.object({
	providers: z
		.object({
			providerId: z.string(),
			type: z.string(),
			issuer: z.string(),
			domain: z.string(),
			autoLinkMatchingEmails: z.boolean(),
			organizationId: z.string().nullable(),
		})
		.array(),
	invitations: z
		.object({
			id: z.string(),
			email: z.string(),
			role: z.string(),
			status: z.string(),
			expiresAt: z.string(),
		})
		.array(),
});

export type SsoSettingsDto = z.infer<typeof ssoSettingsResponse>;

export const getSsoSettingsDto = describeRoute({
	description: "Get SSO providers and invitations for the active organization",
	operationId: "getSsoSettings",
	tags: ["Auth"],
	responses: {
		200: {
			description: "SSO settings for the active organization",
			content: {
				"application/json": {
					schema: resolver(ssoSettingsResponse),
				},
			},
		},
	},
});

export const deleteSsoProviderDto = describeRoute({
	description: "Delete an SSO provider",
	operationId: "deleteSsoProvider",
	tags: ["Auth"],
	responses: {
		200: {
			description: "SSO provider deleted successfully",
		},
		404: {
			description: "Provider not found",
		},
		403: {
			description: "Forbidden",
		},
	},
});

export const deleteSsoInvitationDto = describeRoute({
	description: "Delete an SSO invitation",
	operationId: "deleteSsoInvitation",
	tags: ["Auth"],
	responses: {
		200: {
			description: "SSO invitation deleted successfully",
		},
		403: {
			description: "Forbidden",
		},
	},
});

export const updateSsoProviderAutoLinkingBody = z.object({
	enabled: z.boolean(),
});

export const updateSsoProviderAutoLinkingDto = describeRoute({
	description: "Update whether SSO sign-in can auto-link existing accounts by email",
	operationId: "updateSsoProviderAutoLinking",
	tags: ["Auth"],
	responses: {
		200: {
			description: "SSO provider auto-linking setting updated successfully",
		},
		403: {
			description: "Forbidden",
		},
		404: {
			description: "Provider not found",
		},
	},
});
