import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

const statusResponseSchema = type({
	hasUsers: "boolean",
});

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

export const adminUsersResponse = type({
	users: type({
		id: "string",
		name: "string | null",
		email: "string",
		role: "string",
		banned: "boolean",
		accounts: type({
			id: "string",
			providerId: "string",
		}).array(),
	}).array(),
	total: "number",
});

export type AdminUsersDto = typeof adminUsersResponse.infer;

export const getAdminUsersDto = describeRoute({
	description: "List admin users for settings management",
	operationId: "getAdminUsers",
	tags: ["Auth"],
	responses: {
		200: {
			description: "List of users with roles and status",
			content: {
				"application/json": {
					schema: resolver(adminUsersResponse),
				},
			},
		},
	},
});

export const getStatusDto = describeRoute({
	description: "Get authentication system status",
	operationId: "getStatus",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Authentication system status",
			content: {
				"application/json": {
					schema: resolver(statusResponseSchema),
				},
			},
		},
	},
});

export type GetStatusDto = typeof statusResponseSchema.infer;

export const userDeletionImpactDto = type({
	organizations: type({
		id: "string",
		name: "string",
		resources: {
			volumesCount: "number",
			repositoriesCount: "number",
			backupSchedulesCount: "number",
		},
	}).array(),
});

export type UserDeletionImpactDto = typeof userDeletionImpactDto.infer;

export const getUserDeletionImpactDto = describeRoute({
	description: "Get impact of deleting a user",
	operationId: "getUserDeletionImpact",
	tags: ["Auth"],
	responses: {
		200: {
			description: "List of organizations and resources to be deleted",
			content: {
				"application/json": {
					schema: resolver(userDeletionImpactDto),
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

export const deleteUserAccountDto = describeRoute({
	description: "Delete an account linked to a user",
	operationId: "deleteUserAccount",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Account deleted successfully",
		},
		403: {
			description: "Forbidden",
		},
		409: {
			description: "Cannot delete the last account",
		},
	},
});

export const orgMembersResponse = type({
	members: type({
		id: "string",
		userId: "string",
		role: "string",
		createdAt: "string",
		user: {
			name: "string | null",
			email: "string",
		},
	}).array(),
});

export type OrgMembersDto = typeof orgMembersResponse.infer;

export const getOrgMembersDto = describeRoute({
	description: "Get members of the active organization",
	operationId: "getOrgMembers",
	tags: ["Auth"],
	responses: {
		200: {
			description: "List of organization members",
			content: {
				"application/json": {
					schema: resolver(orgMembersResponse),
				},
			},
		},
	},
});

export const updateMemberRoleBody = type({
	role: "'member' | 'admin'",
});

export const updateMemberRoleDto = describeRoute({
	description: "Update a member's role in the active organization",
	operationId: "updateMemberRole",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Member role updated successfully",
		},
		403: {
			description: "Forbidden",
		},
		404: {
			description: "Member not found",
		},
	},
});

export const removeOrgMemberDto = describeRoute({
	description: "Remove a member from the active organization",
	operationId: "removeOrgMember",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Member removed successfully",
		},
		403: {
			description: "Forbidden",
		},
		404: {
			description: "Member not found",
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
