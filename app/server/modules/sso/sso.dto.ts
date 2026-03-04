import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

export const publicSsoProvidersDto = type({
	providers: type({
		providerId: "string",
		organizationSlug: "string",
	})
		.onUndeclaredKey("delete")
		.array(),
});

export type PublicSsoProvidersDto = typeof publicSsoProvidersDto.infer;

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

export const ssoSettingsResponse = type({
	providers: type({
		providerId: "string",
		type: "string",
		issuer: "string",
		domain: "string",
		autoLinkMatchingEmails: "boolean",
		organizationId: "string | null",
	}).array(),
	invitations: type({
		id: "string",
		email: "string",
		role: "string",
		status: "string",
		expiresAt: "string",
	}).array(),
});

export type SsoSettingsDto = typeof ssoSettingsResponse.infer;

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

export const updateSsoProviderAutoLinkingBody = type({
	enabled: "boolean",
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
