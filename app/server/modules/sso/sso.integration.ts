import { sso } from "@better-auth/sso";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth";
import type { GenericEndpointContext, User } from "better-auth";
import { db } from "~/server/db/db";
import { invitation, member } from "~/server/db/schema";
import { authService } from "../auth/auth.service";
import { ssoService } from "./sso.service";
import { validateSsoProviderId } from "./middlewares/validate-provider-id";
import { validateSsoCallbackUrls } from "./middlewares/validate-callback-urls";
import { authorizeSsoRegistration } from "./middlewares/authorize-registration";
import { requireSsoInvitation } from "./middlewares/require-invitation";
import { resolveTrustedProvidersForRequest } from "./middlewares/trust-provider-for-linking";
import { isSsoCallbackRequest, extractProviderIdFromContext, normalizeEmail } from "./utils/sso-context";
import { findMembershipWithOrganization } from "~/server/lib/auth/helpers/create-default-org";
import { logger } from "@zerobyte/core/node";

async function resolveOrgMembership(userId: string, ctx: GenericEndpointContext | null) {
	const user = await db.query.usersTable.findFirst({ where: { id: userId } });
	if (!user) {
		return null;
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		return null;
	}

	const ssoProviderRecord = await ssoService.getSsoProviderById(providerId);
	if (!ssoProviderRecord) {
		return null;
	}

	const existingSsoMembership = await findMembershipWithOrganization(user.id, ssoProviderRecord.organizationId);
	if (existingSsoMembership) {
		return existingSsoMembership;
	}

	logger.debug("Checking for pending invitations for user", { userId, providerId: ssoProviderRecord.providerId });

	const pendingInvitation = await ssoService.getPendingInvitation(
		ssoProviderRecord.organizationId,
		normalizeEmail(user.email),
	);

	if (!pendingInvitation) {
		logger.debug("No pending invitation found for user");
		throw new APIError("FORBIDDEN", { message: "SSO sign-in is invite-only for this organization" });
	}

	db.transaction((tx) => {
		tx.insert(member)
			.values({
				id: Bun.randomUUIDv7(),
				userId,
				role: pendingInvitation.role as "member",
				organizationId: pendingInvitation.organizationId,
				createdAt: new Date(),
			})
			.run();

		tx.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, pendingInvitation.id)).run();
	});

	const invitedMembership = await findMembershipWithOrganization(userId, pendingInvitation.organizationId);
	logger.debug("Created organization membership from invitation", {
		userId,
		organizationId: pendingInvitation.organizationId,
	});

	if (!invitedMembership) {
		throw new Error("Failed to create invited organization membership");
	}

	return invitedMembership;
}

async function onUserCreate(
	user: User & { hasDownloadedResticPassword?: boolean },
	ctx: GenericEndpointContext | null,
) {
	await requireSsoInvitation(user.email, ctx);
	user.hasDownloadedResticPassword = true;
}

async function canLinkSsoAccount(userId: string, providerId: string): Promise<boolean> {
	const ssoProviderRecord = await ssoService.getSsoProviderById(providerId);
	if (!ssoProviderRecord) {
		return false;
	}

	const existingMembership = await findMembershipWithOrganization(userId, ssoProviderRecord.organizationId);
	if (existingMembership) {
		return true;
	}

	const existingAccount = await db.query.account.findFirst({
		where: { userId },
		columns: { id: true },
	});

	if (existingAccount) {
		return false;
	}

	const user = await db.query.usersTable.findFirst({ where: { id: userId } });
	if (!user) {
		return false;
	}

	const pendingInvitation = await ssoService.getPendingInvitation(
		ssoProviderRecord.organizationId,
		normalizeEmail(user.email),
	);

	return !!pendingInvitation;
}

async function resolveOrgMembershipOrThrow(userId: string, ctx: GenericEndpointContext | null) {
	const membership = await resolveOrgMembership(userId, ctx);
	if (!membership) {
		throw new APIError("BAD_REQUEST", {
			message: "Unable to resolve organization membership for this SSO session",
		});
	}

	return membership;
}

async function onUserCreated(user: User, ctx: GenericEndpointContext | null) {
	await resolveOrgMembershipOrThrow(user.id, ctx);
}

export const ssoIntegration = {
	plugin: sso({
		trustEmailVerified: false,
		providersLimit: async (user: User) => {
			const isOrgAdmin = await authService.isOrgAdminAnywhere(user.id);
			return isOrgAdmin ? 10 : 0;
		},
		organizationProvisioning: {
			disabled: false,
			defaultRole: "member",
		},
	}),

	beforeMiddlewares: [validateSsoProviderId, validateSsoCallbackUrls, authorizeSsoRegistration] as const,

	isSsoCallback: isSsoCallbackRequest,

	onUserCreate,

	onUserCreated,

	resolveOrgMembershipOrThrow,

	resolveOrgMembership,

	canLinkSsoAccount,

	resolveTrustedProviders: resolveTrustedProvidersForRequest,
};
