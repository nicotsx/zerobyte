import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";

const statusResponseSchema = z.object({
	hasUsers: z.boolean(),
});

export const adminUsersResponse = z.object({
	users: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string(),
			role: z.string(),
			banned: z.boolean(),
			accounts: z
				.object({
					id: z.string(),
					providerId: z.string(),
				})
				.array(),
		})
		.array(),
	total: z.number(),
});

export type AdminUsersDto = z.infer<typeof adminUsersResponse>;

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

export type GetStatusDto = z.infer<typeof statusResponseSchema>;

export const userDeletionImpactDto = z.object({
	organizations: z
		.object({
			id: z.string(),
			name: z.string(),
			resources: z.object({
				volumesCount: z.number(),
				repositoriesCount: z.number(),
				backupSchedulesCount: z.number(),
			}),
		})
		.array(),
});

export type UserDeletionImpactDto = z.infer<typeof userDeletionImpactDto>;

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

export const deleteUserAccountDto = describeRoute({
	description: "Delete an account linked to a user",
	operationId: "deleteUserAccount",
	tags: ["Auth"],
	responses: {
		200: {
			description: "Account deleted successfully",
		},
		404: {
			description: "Account not found",
		},
		409: {
			description: "Cannot delete the last account",
		},
	},
});

export const orgMembersResponse = z.object({
	members: z
		.object({
			id: z.string(),
			userId: z.string(),
			role: z.string(),
			createdAt: z.string(),
			user: z.object({
				name: z.string().nullable(),
				email: z.string(),
			}),
		})
		.array(),
});

export type OrgMembersDto = z.infer<typeof orgMembersResponse>;

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

export const updateMemberRoleBody = z.object({
	role: z.enum(["member", "admin"]),
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
