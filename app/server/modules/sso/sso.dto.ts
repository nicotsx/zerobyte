import { ssoDiscoveryResultSchema, ssoProviderDetailsSchema } from "~/lib/sso-configuration";
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

const userSsoInvitationsResponse = z
	.object({
		id: z.string(),
		organizationName: z.string(),
		role: z.string(),
		expiresAt: z.string(),
		ssoProviders: z.object({ providerId: z.string() }).array(),
	})
	.array();

export type UserSsoInvitationsDto = z.infer<typeof userSsoInvitationsResponse>;

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

export const getUserSsoInvitationsDto = describeRoute({
	description: "Get pending SSO invitations for the authenticated user",
	operationId: "getUserSsoInvitations",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Pending SSO invitations",
			content: {
				"application/json": {
					schema: resolver(userSsoInvitationsResponse),
				},
			},
		},
	},
});

export const getSsoAccountLinkProvidersDto = describeRoute({
	description: "List OIDC providers the current user can link to in their active organization",
	operationId: "getSsoAccountLinkProviders",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Account linking providers",
			content: {
				"application/json": {
					schema: resolver(
						z.array(z.object({ providerId: z.string(), issuer: z.string(), linked: z.boolean() })),
					),
				},
			},
		},
	},
});

export const startSsoAccountLinkBody = z.strictObject({ providerId: z.string().min(1) });

export const startSsoAccountLinkDto = describeRoute({
	description: "Start linking an OIDC provider to the signed-in account",
	operationId: "startSsoAccountLink",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Identity provider authorization URL",
			content: { "application/json": { schema: resolver(z.object({ url: z.string() })) } },
		},
		400: { description: "The provider is unavailable or already linked" },
		401: { description: "Browser session required" },
	},
});

export const startInvitationSsoVerificationBody = z.object({
	providerId: z.string(),
});

export const startInvitationSsoVerificationDto = describeRoute({
	description: "Start SSO verification for accepting an organization invitation",
	operationId: "startInvitationSsoVerification",
	tags: ["Auth"],
	responses: {
		200: {
			description: "SSO verification intent created",
		},
		400: {
			description: "Invalid provider",
		},
		403: {
			description: "Forbidden",
		},
		404: {
			description: "Invitation not found",
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

export const getSsoProviderDetailsDto = describeRoute({
	operationId: "getSsoProviderDetails",
	description: "Get editable OIDC settings and callback diagnostics for an organization provider",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Provider settings and callback diagnostics",
			content: { "application/json": { schema: resolver(ssoProviderDetailsSchema) } },
		},
	},
});

export const checkSsoProviderDiscoveryDto = describeRoute({
	operationId: "checkSsoProviderDiscovery",
	description: "Check an organization's saved OIDC settings against its discovery document",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Discovery diagnostics",
			content: { "application/json": { schema: resolver(ssoDiscoveryResultSchema) } },
		},
	},
});

export const updateSsoProviderDto = describeRoute({
	operationId: "updateSsoProvider",
	description: "Update an organization's OIDC provider while preserving linked accounts",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Provider updated",
			content: { "application/json": { schema: resolver(z.object({ success: z.boolean() })) } },
		},
	},
});
