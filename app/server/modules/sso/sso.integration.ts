import { sso } from "@better-auth/sso";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth";
import type { Account, GenericEndpointContext, User } from "better-auth";
import { db } from "~/server/db/db";
import { invitation, member } from "~/server/db/schema";
import { authService } from "../auth/auth.service";
import { ssoService } from "./sso.service";
import {
	accountLinkRequired,
	attachSsoAccountLink,
	completeSsoAccountLink,
	getSsoAccountLink,
} from "./sso-account-link";
import { validateSsoRegistrationIssuer } from "./middlewares/validate-registration-issuer";
import { validateSsoProviderId } from "./middlewares/validate-provider-id";
import { validateSsoCallbackUrls } from "./middlewares/validate-callback-urls";
import { authorizeSsoRegistration } from "./middlewares/authorize-registration";
import { enforceOidcSso } from "./middlewares/enforce-oidc";
import { requireSsoInvitation } from "./middlewares/require-invitation";
import { resolveTrustedProvidersForRequest } from "./middlewares/trust-provider-for-linking";
import { isSsoCallbackRequest, extractProviderIdFromContext, normalizeEmail } from "./utils/sso-context";
import { findMembershipWithOrganization } from "~/server/lib/auth/helpers/create-default-org";
import { logger } from "@zerobyte/core/node";

const invitedSsoSignups = new WeakSet<Request>();

type AcceptInvitationHookData = {
	invitation: {
		organizationId: string;
	};
};

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
		throw new APIError("FORBIDDEN", {
			code: "INVITE_REQUIRED",
			message: "SSO sign-in is invite-only for this organization",
		});
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

	await ssoService.consumeInvitationSsoIntent(ssoService.getInvitationIntentTokenFromRequest(ctx?.request));

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

async function requireSsoSignIn() {
	if (await getSsoAccountLink()) throw accountLinkRequired();
}

async function rejectAccountLinkWrite(_data: object, ctx: GenericEndpointContext | null) {
	if (isSsoCallbackRequest(ctx)) await requireSsoSignIn();
}

async function onAccountCreate(binding: Omit<Account, "id">, ctx: GenericEndpointContext | null) {
	if (!ctx || !isSsoCallbackRequest(ctx)) return;

	const link = await getSsoAccountLink();
	if (link) return completeSsoAccountLink(ctx, link, binding);

	const allowed = await canLinkSsoAccount(binding.userId, binding.providerId, ctx);
	if (!allowed) throw accountLinkRequired();
}

async function onUserCreate(
	user: User & { hasDownloadedResticPassword?: boolean },
	ctx: GenericEndpointContext | null,
) {
	if (!isSsoCallbackRequest(ctx)) return;

	await requireSsoSignIn();
	await requireSsoInvitation(user.email, ctx);
	if (ctx?.request) invitedSsoSignups.add(ctx.request);

	user.hasDownloadedResticPassword = true;
}

async function canLinkSsoAccount(
	userId: string,
	providerId: string,
	ctx: GenericEndpointContext | null,
): Promise<boolean> {
	const ssoProviderRecord = await ssoService.getSsoProviderById(providerId);
	if (!ssoProviderRecord) {
		return false;
	}

	if (ctx?.request && extractProviderIdFromContext(ctx) === providerId && invitedSsoSignups.delete(ctx.request)) {
		return true;
	}

	const existingMembership = await findMembershipWithOrganization(userId, ssoProviderRecord.organizationId);
	if (existingMembership) return false;

	const user = await db.query.usersTable.findFirst({ where: { id: userId } });
	if (!user) {
		return false;
	}

	const pendingInvitation = await ssoService.getPendingInvitation(
		ssoProviderRecord.organizationId,
		normalizeEmail(user.email),
	);

	if (!pendingInvitation) {
		return false;
	}

	const invitationIntent = await ssoService.getValidInvitationSsoIntent(
		ssoService.getInvitationIntentTokenFromRequest(ctx?.request),
	);

	return (
		invitationIntent?.userId === userId &&
		invitationIntent.providerId === providerId &&
		invitationIntent.organizationId === ssoProviderRecord.organizationId &&
		invitationIntent.invitationId === pendingInvitation.id &&
		normalizeEmail(invitationIntent.email) === normalizeEmail(user.email)
	);
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
	if (isSsoCallbackRequest(ctx)) await resolveOrgMembershipOrThrow(user.id, ctx);
}

async function resolveSessionMembership(userId: string, ctx: GenericEndpointContext | null) {
	if (!isSsoCallbackRequest(ctx)) return null;

	await requireSsoSignIn();
	return resolveOrgMembershipOrThrow(userId, ctx);
}

async function beforeAcceptInvitation({ invitation }: AcceptInvitationHookData) {
	const provider = await db.query.ssoProvider.findFirst({
		where: { organizationId: invitation.organizationId },
		columns: { id: true },
	});

	if (provider) {
		throw new APIError("FORBIDDEN");
	}
}

export const ssoIntegration = {
	plugin: sso({
		trustEmailVerified: true,
		providersLimit: async (user: User) => {
			const isOrgAdmin = await authService.isOrgAdminAnywhere(user.id);
			return isOrgAdmin ? 10 : 0;
		},
		organizationProvisioning: {
			disabled: false,
			defaultRole: "member",
		},
	}),

	beforeMiddlewares: [
		enforceOidcSso,
		validateSsoProviderId,
		validateSsoCallbackUrls,
		authorizeSsoRegistration,
		validateSsoRegistrationIssuer,
		attachSsoAccountLink,
	] as const,

	onAccountCreate,

	rejectAccountLinkWrite,

	onUserCreate,

	onUserCreated,

	beforeAcceptInvitation,

	resolveSessionMembership,

	resolveOrgMembership,

	canLinkSsoAccount,

	resolveTrustedProviders: resolveTrustedProvidersForRequest,
};
