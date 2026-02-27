import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "@better-auth/core";
import { db } from "~/server/db/db";
import { logger } from "~/server/utils/logger";
import { extractProviderIdFromContext, extractProviderIdFromUrl, normalizeEmail } from "../utils/sso-context";

export function isSsoCallbackRequest(ctx: GenericEndpointContext | null) {
	if (!ctx?.request?.url) {
		return false;
	}

	return extractProviderIdFromUrl(ctx.request.url) !== null;
}

export const requireSsoInvitation = async (userEmail: string, ctx: GenericEndpointContext | null) => {
	if (!ctx) {
		throw new APIError("BAD_REQUEST", { message: "Missing SSO context" });
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		throw new APIError("BAD_REQUEST", { message: "Missing providerId in context" });
	}

	const provider = await db.query.ssoProvider.findFirst({ where: { providerId } });
	if (!provider) {
		throw new APIError("NOT_FOUND", { message: "SSO provider not found" });
	}

	const normalizedEmail = normalizeEmail(userEmail);
	logger.debug("Checking for pending invitations", { organizationId: provider.organizationId });

	const pendingInvitation = await db.query.invitation.findFirst({
		where: {
			AND: [
				{ organizationId: provider.organizationId },
				{ status: "pending" },
				{ expiresAt: { gt: new Date() } },
				{ email: normalizedEmail },
			],
		},
		columns: { id: true },
	});

	logger.debug("Pending invitation result", { found: !!pendingInvitation, invitationId: pendingInvitation?.id });

	if (!pendingInvitation) {
		throw new APIError("FORBIDDEN", {
			message: "Access denied. You must be invited to this organization before you can sign in with SSO.",
		});
	}
};
