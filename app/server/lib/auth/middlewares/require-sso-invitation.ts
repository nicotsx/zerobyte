import { and, eq, gt } from "drizzle-orm";
import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { invitation, ssoProvider } from "~/server/db/schema";
import { logger } from "~/server/utils/logger";
import { extractProviderIdFromContext, normalizeEmail } from "../utils/sso-context";

export function isSsoCallbackRequest(ctx: GenericEndpointContext | null) {
	if (!ctx) {
		return false;
	}

	return extractProviderIdFromContext(ctx) !== null;
}

export const requireSsoInvitation = async (userEmail: string, ctx: GenericEndpointContext | null) => {
	if (!ctx) {
		return;
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		return;
	}

	const provider = await db
		.select({ organizationId: ssoProvider.organizationId })
		.from(ssoProvider)
		.where(eq(ssoProvider.providerId, providerId))
		.limit(1);

	if (provider.length === 0) {
		return;
	}

	const normalizedEmail = normalizeEmail(userEmail);
	const now = new Date();

	logger.debug(
		"Checking for pending invitations for email %s in organization %s",
		normalizedEmail,
		provider[0].organizationId,
	);

	const pendingInvitations = await db
		.select({ id: invitation.id, email: invitation.email })
		.from(invitation)
		.where(
			and(
				eq(invitation.organizationId, provider[0].organizationId),
				eq(invitation.status, "pending"),
				gt(invitation.expiresAt, now),
			),
		);

	const pendingInvitation = pendingInvitations.find(
		(invitationCandidate) => normalizeEmail(invitationCandidate.email) === normalizedEmail,
	);

	if (!pendingInvitation) {
		throw new APIError("FORBIDDEN", {
			message: "Access denied. You must be invited to this organization before you can sign in with SSO.",
		});
	}
};
