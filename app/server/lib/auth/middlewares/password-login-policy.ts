import { logger } from "@zerobyte/core/node";
import { ForbiddenError } from "http-errors-enhanced";
import type { AuthMiddlewareContext } from "~/server/lib/auth";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { systemService } from "~/server/modules/system/system.service";

export const enforcePasswordLoginPolicy = async (ctx: AuthMiddlewareContext) => {
	if (ctx.path !== "/sign-in/email" && ctx.path !== "/sign-in/username") {
		return;
	}

	if (serverHasRuntimeFeature("passwordAuthentication") && !(await systemService.isPasswordLoginDisabled())) {
		return;
	}

	logger.info("Password login attempt blocked: password login is not enabled.");
	throw new ForbiddenError("Password login is disabled. Please use another sign-in method.");
};
