import { Hono } from "hono";
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

		const [providersData, invitationsData] = await Promise.all([
			auth.api.listSSOProviders({ headers }),
			auth.api.listInvitations({
				headers,
				query: { organizationId: activeOrganizationId },
			}),
		]);

		return c.json<SsoSettingsDto>({
			providers: providersData.providers.map((provider) => ({
				providerId: provider.providerId,
				type: provider.type,
				issuer: provider.issuer,
				domain: provider.domain,
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
		await authService.deleteSsoProvider(providerId);

		return c.json({ success: true });
	})
	.delete("/sso-invitations/:invitationId", requireAuth, requireAdmin, deleteSsoInvitationDto, async (c) => {
		const invitationId = c.req.param("invitationId");
		await authService.deleteSsoInvitation(invitationId);

		return c.json({ success: true });
	})
	.get("/admin-users", requireAuth, requireAdmin, getAdminUsersDto, async (c) => {
		const headers = c.req.raw.headers;

		const usersData = await auth.api.listUsers({
			headers,
			query: { limit: 100 },
		});

		return c.json<AdminUsersDto>({
			users: usersData.users.map((adminUser) => ({
				id: adminUser.id,
				name: adminUser.name,
				email: adminUser.email,
				role: adminUser.role ?? "user",
				banned: Boolean(adminUser.banned),
			})),
			total: usersData.total,
			limit: "limit" in usersData ? (usersData.limit ?? 100) : 100,
		});
	})
	.get("/deletion-impact/:userId", requireAuth, requireAdmin, getUserDeletionImpactDto, async (c) => {
		const userId = c.req.param("userId");
		const impact = await authService.getUserDeletionImpact(userId);
		return c.json<UserDeletionImpactDto>(impact);
	});
