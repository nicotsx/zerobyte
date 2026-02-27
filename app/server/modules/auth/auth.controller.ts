import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	type GetStatusDto,
	getStatusDto,
	getUserDeletionImpactDto,
	type UserDeletionImpactDto,
	getPublicSsoProvidersDto,
	type PublicSsoProvidersDto,
	getSsoSettingsDto,
	type SsoSettingsDto,
	getAdminUsersDto,
	type AdminUsersDto,
	deleteSsoProviderDto,
	deleteSsoInvitationDto,
	updateSsoProviderAutoLinkingBody,
	updateSsoProviderAutoLinkingDto,
	deleteUserAccountDto,
} from "./auth.dto";
import { authService } from "./auth.service";
import { requireAdmin, requireAuth } from "./auth.middleware";
import { auth } from "~/server/lib/auth";

export const authController = new Hono()
	.get("/status", getStatusDto, async (c) => {
		const hasUsers = await authService.hasUsers();
		return c.json<GetStatusDto>({ hasUsers });
	})
	.get("/sso-providers", getPublicSsoProvidersDto, async (c) => {
		const providers = await authService.getPublicSsoProviders();
		return c.json<PublicSsoProvidersDto>(providers);
	})
	.get("/sso-settings", requireAuth, requireAdmin, getSsoSettingsDto, async (c) => {
		const headers = c.req.raw.headers;
		const activeOrganizationId = c.get("organizationId");

		if (!activeOrganizationId) {
			return c.json<SsoSettingsDto>({ providers: [], invitations: [] });
		}

		const [providersData, invitationsData, autoLinkingSettings] = await Promise.all([
			auth.api.listSSOProviders({ headers }),
			auth.api.listInvitations({ headers, query: { organizationId: activeOrganizationId } }),
			authService.getSsoProviderAutoLinkingSettings(activeOrganizationId),
		]);

		return c.json<SsoSettingsDto>({
			providers: providersData.providers.map((provider) => ({
				providerId: provider.providerId,
				type: provider.type,
				issuer: provider.issuer,
				domain: provider.domain,
				autoLinkMatchingEmails: autoLinkingSettings[provider.providerId] ?? false,
				organizationId: provider.organizationId,
			})),
			invitations: invitationsData.map((invitation) => ({
				id: invitation.id,
				email: invitation.email,
				role: invitation.role,
				status: invitation.status,
				expiresAt: invitation.expiresAt.toISOString(),
			})),
		});
	})
	.delete("/sso-providers/:providerId", requireAuth, requireAdmin, deleteSsoProviderDto, async (c) => {
		const providerId = c.req.param("providerId");
		const organizationId = c.get("organizationId");

		const deleted = await authService.deleteSsoProvider(providerId, organizationId);

		if (!deleted) {
			return c.json({ message: "Provider not found" }, 404);
		}

		return c.json({ success: true });
	})
	.patch(
		"/sso-providers/:providerId/auto-linking",
		requireAuth,
		requireAdmin,
		updateSsoProviderAutoLinkingDto,
		validator("json", updateSsoProviderAutoLinkingBody),
		async (c) => {
			const providerId = c.req.param("providerId");
			const organizationId = c.get("organizationId");
			const { enabled } = c.req.valid("json");

			const updated = await authService.updateSsoProviderAutoLinking(providerId, organizationId, enabled);

			if (!updated) {
				return c.json({ message: "Provider not found" }, 404);
			}

			return c.json({ success: true });
		},
	)
	.delete("/sso-invitations/:invitationId", requireAuth, requireAdmin, deleteSsoInvitationDto, async (c) => {
		const invitationId = c.req.param("invitationId");
		const organizationId = c.get("organizationId");

		const invitation = await authService.getSsoInvitationById(invitationId);
		if (!invitation || invitation.organizationId !== organizationId) {
			return c.json({ message: "Invitation not found" }, 404);
		}

		await authService.deleteSsoInvitation(invitationId);

		return c.json({ success: true });
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
	});
