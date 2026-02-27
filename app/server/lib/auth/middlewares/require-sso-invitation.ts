import { APIError } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";
import { logger } from "~/server/utils/logger";
import { extractProviderIdFromContext } from "../utils/sso-context";
import { authService } from "~/server/modules/auth/auth.service";

export const requireSsoInvitation = async (userEmail: string, ctx: GenericEndpointContext | null) => {
	if (!ctx) {
		throw new APIError("BAD_REQUEST", { message: "Missing SSO context" });
	}

	const providerId = extractProviderIdFromContext(ctx);
	if (!providerId) {
		throw new APIError("BAD_REQUEST", { message: "Missing providerId in context" });
	}

	const provider = await authService.getSsoProviderById(providerId);
	if (!provider) {
		throw new APIError("NOT_FOUND", { message: "SSO provider not found" });
	}

	logger.debug("Checking for pending invitations", { organizationId: provider.organizationId });

	const pendingInvitation = await authService.getPendingInvitation(provider.organizationId, userEmail);

	logger.debug("Pending invitation result", { found: !!pendingInvitation, invitationId: pendingInvitation?.id });

	if (!pendingInvitation) {
		throw new APIError("FORBIDDEN", {
			message: "Access denied. You must be invited to this organization before you can sign in with SSO.",
		});
	}
};
