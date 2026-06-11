import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	type PublicSsoProvidersDto,
	type SsoSettingsDto,
	type UserSsoInvitationsDto,
	deleteSsoInvitationDto,
	deleteSsoProviderDto,
	getPublicSsoProvidersDto,
	getSsoSettingsDto,
	getUserSsoInvitationsDto,
	startInvitationSsoVerificationBody,
	startInvitationSsoVerificationDto,
	updateSsoProviderAutoLinkingBody,
	updateSsoProviderAutoLinkingDto,
} from "./sso.dto";
import { SSO_INVITATION_INTENT_COOKIE, ssoService } from "./sso.service";
import { requireAuth, requireBrowserSession, requireOrgAdmin } from "../auth/auth.middleware";
import { auth } from "~/server/lib/auth";
import { mapAuthErrorToCode } from "./sso.errors";
import { config } from "~/server/core/config";
import { setCookie } from "hono/cookie";
import { normalizeEmail } from "./utils/sso-context";

export const ssoController = new Hono()
	.get("/sso-providers", getPublicSsoProvidersDto, async (c) => {
		const providers = await ssoService.getPublicSsoProviders();
		return c.json<PublicSsoProvidersDto>(providers);
	})
	.get("/sso-settings", requireAuth, requireBrowserSession, requireOrgAdmin, getSsoSettingsDto, async (c) => {
		const headers = c.req.raw.headers;
		const activeOrganizationId = c.get("organizationId");

		if (!activeOrganizationId) {
			return c.json<SsoSettingsDto>({ providers: [], invitations: [] });
		}

		const [providersData, invitationsData, autoLinkingSettings] = await Promise.all([
			auth.api.listSSOProviders({ headers, query: { organizationId: activeOrganizationId } }),
			auth.api.listInvitations({ headers, query: { organizationId: activeOrganizationId } }),
			ssoService.getSsoProviderAutoLinkingSettings(activeOrganizationId),
		]);

		return c.json<SsoSettingsDto>({
			providers: providersData.providers
				.map((provider) => ({
					providerId: provider.providerId,
					type: provider.type,
					issuer: provider.issuer,
					domain: provider.domain,
					autoLinkMatchingEmails: autoLinkingSettings[provider.providerId] ?? false,
					organizationId: provider.organizationId,
				}))
				.filter((p) => p.organizationId === activeOrganizationId),
			invitations: invitationsData.map((invitation) => ({
				id: invitation.id,
				email: invitation.email,
				role: invitation.role,
				status: invitation.status,
				expiresAt: invitation.expiresAt.toISOString(),
			})),
		});
	})
	.get("/sso-invitations", requireAuth, getUserSsoInvitationsDto, async (c) => {
		const user = c.get("user");
		const invitations = await ssoService.listPendingInvitationsForUser(user.email);

		return c.json<UserSsoInvitationsDto>(invitations);
	})
	.post(
		"/sso-invitations/:invitationId/verify",
		requireAuth,
		startInvitationSsoVerificationDto,
		validator("json", startInvitationSsoVerificationBody),
		async (c) => {
			const user = c.get("user");
			const invitationId = c.req.param("invitationId");
			const { providerId } = c.req.valid("json");

			const invitation = await ssoService.getPendingInvitationById(invitationId);
			if (!invitation || normalizeEmail(invitation.email) !== normalizeEmail(user.email)) {
				return c.json({ message: "Invitation not found" }, 404);
			}

			const provider = await ssoService.getSsoProviderForOrganization(providerId, invitation.organizationId);
			if (!provider) {
				return c.json({ message: "Provider not found for invitation organization" }, 400);
			}

			const token = await ssoService.createInvitationSsoIntent({
				userId: user.id,
				invitationId: invitation.id,
				providerId,
				organizationId: invitation.organizationId,
				email: user.email,
			});

			setCookie(c, SSO_INVITATION_INTENT_COOKIE, token, {
				httpOnly: true,
				sameSite: "Lax",
				secure: config.isSecure,
				path: "/api/auth",
				maxAge: 10 * 60,
			});

			return c.json({ success: true });
		},
	)
	.delete("/sso-providers/:providerId", requireAuth, requireOrgAdmin, deleteSsoProviderDto, async (c) => {
		const providerId = c.req.param("providerId");
		const organizationId = c.get("organizationId");

		const deleted = await ssoService.deleteSsoProvider(providerId, organizationId);

		if (!deleted) {
			return c.json({ message: "Provider not found" }, 404);
		}

		return c.json({ success: true });
	})
	.patch(
		"/sso-providers/:providerId/auto-linking",
		requireAuth,
		requireOrgAdmin,
		updateSsoProviderAutoLinkingDto,
		validator("json", updateSsoProviderAutoLinkingBody),
		async (c) => {
			const providerId = c.req.param("providerId");
			const organizationId = c.get("organizationId");
			const { enabled } = c.req.valid("json");

			const updated = await ssoService.updateSsoProviderAutoLinking(providerId, organizationId, enabled);

			if (!updated) {
				return c.json({ message: "Provider not found" }, 404);
			}

			return c.json({ success: true });
		},
	)
	.delete("/sso-invitations/:invitationId", requireAuth, requireOrgAdmin, deleteSsoInvitationDto, async (c) => {
		const invitationId = c.req.param("invitationId");
		const organizationId = c.get("organizationId");

		const invitation = await ssoService.getSsoInvitationById(invitationId);
		if (!invitation || invitation.organizationId !== organizationId) {
			return c.json({ message: "Invitation not found" }, 404);
		}

		await ssoService.deleteSsoInvitation(invitationId);

		return c.json({ success: true });
	})
	.get("/login-error", async (c) => {
		const error = c.req.query("error");
		const errorCode = error ? mapAuthErrorToCode(error) : "SSO_LOGIN_FAILED";
		return c.redirect(`${config.baseUrl}/login?error=${errorCode}`);
	});
