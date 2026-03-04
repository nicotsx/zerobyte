import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	type GetStatusDto,
	getStatusDto,
	getUserDeletionImpactDto,
	type UserDeletionImpactDto,
	getAdminUsersDto,
	type AdminUsersDto,
	deleteUserAccountDto,
	getOrgMembersDto,
	type OrgMembersDto,
	updateMemberRoleBody,
	updateMemberRoleDto,
	removeOrgMemberDto,
} from "./auth.dto";
import { authService } from "./auth.service";
import { requireAdmin, requireAuth, requireOrgAdmin } from "./auth.middleware";
import { auth } from "~/server/lib/auth";

export const authController = new Hono()
	.get("/status", getStatusDto, async (c) => {
		const hasUsers = await authService.hasUsers();
		return c.json<GetStatusDto>({ hasUsers });
	})
	.get("/admin-users", requireAuth, requireAdmin, getAdminUsersDto, async (c) => {
		const headers = c.req.raw.headers;

		const usersData = await auth.api.listUsers({
			headers,
			query: { limit: 100 },
		});

		const userIds = usersData.users.map((u) => u.id);
		const accountsByUser = await authService.getUserAccounts(userIds);

		return c.json<AdminUsersDto>({
			users: usersData.users.map((adminUser) => ({
				id: adminUser.id,
				name: adminUser.name,
				email: adminUser.email,
				role: adminUser.role ?? "user",
				banned: Boolean(adminUser.banned),
				accounts: accountsByUser[adminUser.id] ?? [],
			})),
			total: usersData.total,
		});
	})
	.delete("/admin-users/:userId/accounts/:accountId", requireAuth, requireAdmin, deleteUserAccountDto, async (c) => {
		const userId = c.req.param("userId");
		const accountId = c.req.param("accountId");
		const organizationId = c.get("organizationId");

		const result = await authService.deleteUserAccount(userId, accountId, organizationId);

		if (result.forbidden) {
			return c.json({ message: "User is not a member of this organization" }, 403);
		}

		if (result.lastAccount) {
			return c.json({ message: "Cannot delete the last account of a user" }, 409);
		}

		return c.json({ success: true });
	})
	.get("/deletion-impact/:userId", requireAuth, requireAdmin, getUserDeletionImpactDto, async (c) => {
		const userId = c.req.param("userId");
		const impact = await authService.getUserDeletionImpact(userId);
		return c.json<UserDeletionImpactDto>(impact);
	})
	.get("/org-members", requireAuth, requireOrgAdmin, getOrgMembersDto, async (c) => {
		const organizationId = c.get("organizationId");
		const result = await authService.getOrgMembers(organizationId);
		return c.json<OrgMembersDto>(result);
	})
	.patch(
		"/org-members/:memberId/role",
		requireAuth,
		requireOrgAdmin,
		updateMemberRoleDto,
		validator("json", updateMemberRoleBody),
		async (c) => {
			const memberId = c.req.param("memberId");
			const organizationId = c.get("organizationId");
			const { role } = c.req.valid("json");

			const result = await authService.updateMemberRole(memberId, organizationId, role);

			if (!result.found) {
				return c.json({ message: "Member not found" }, 404);
			}

			if (result.isOwner) {
				return c.json({ message: "Cannot change the role of the organization owner" }, 403);
			}

			return c.json({ success: true });
		},
	)
	.delete("/org-members/:memberId", requireAuth, requireOrgAdmin, removeOrgMemberDto, async (c) => {
		const memberId = c.req.param("memberId");
		const organizationId = c.get("organizationId");

		const result = await authService.removeOrgMember(memberId, organizationId);

		if (!result.found) {
			return c.json({ message: "Member not found" }, 404);
		}

		if (result.isOwner) {
			return c.json({ message: "Cannot remove the organization owner" }, 403);
		}

		return c.json({ success: true });
	});
