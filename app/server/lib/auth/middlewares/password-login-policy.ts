import { logger } from "@zerobyte/core/node";
import { ForbiddenError } from "http-errors-enhanced";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { isPasswordAuthSupported } from "~/server/modules/auth/helpers";
import { systemService } from "~/server/modules/system/system.service";

const PASSWORD_SIGN_IN_PATHS = new Set(["/sign-in/email", "/sign-in/username"]);

export const enforcePasswordLoginPolicy = async (ctx: AuthMiddlewareContext) => {
	if (!PASSWORD_SIGN_IN_PATHS.has(ctx.path)) {
		return;
	}

	if (isPasswordAuthSupported() && (await systemService.isPasswordLoginEnabled())) {
		return;
	}

	logger.info("Password login attempt blocked: password login is not enabled.");
	throw new ForbiddenError("Password login is disabled. Please use another sign-in method.");
};
