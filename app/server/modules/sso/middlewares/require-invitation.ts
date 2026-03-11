import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import { logger } from "@zerobyte/core/node";
import { extractProviderIdFromContext } from "~/server/modules/sso/utils/sso-context";
import { ssoService } from "~/server/modules/sso/sso.service";

export const requireSsoInvitation = async (userEmail: string, ctx: GenericEndpointContext | null) => {
	if (!ctx) {
		throw new APIError("BAD_REQUEST", { message: "Missing SSO context" });
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		throw new APIError("BAD_REQUEST", { message: "Missing providerId in context" });
	}

	const provider = await ssoService.getSsoProviderById(providerId);
	if (!provider) {
		throw new APIError("NOT_FOUND", { message: "SSO provider not found" });
	}

	logger.debug("Checking for pending invitations", { organizationId: provider.organizationId });

	const pendingInvitation = await ssoService.getPendingInvitation(provider.organizationId, userEmail);

	logger.debug("Pending invitation result", { found: !!pendingInvitation, invitationId: pendingInvitation?.id });

	if (!pendingInvitation) {
		throw new APIError("FORBIDDEN", {
			message: "Access denied. You must be invited to this organization before you can sign in with SSO.",
		});
	}
};
