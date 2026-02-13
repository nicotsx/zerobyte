import { db } from "~/server/db/db";
import type { AuthMiddlewareContext } from "../auth";
import { logger } from "~/server/utils/logger";
import { ForbiddenError } from "http-errors-enhanced";
import { REGISTRATION_ENABLED_KEY } from "~/server/core/constants";

export const ensureOnlyOneUser = async (ctx: AuthMiddlewareContext) => {
	const { path } = ctx;
	const existingUser = await db.query.usersTable.findFirst();

	if (path !== "/sign-up/email") {
		return;
	}

	const result = await db.query.appMetadataTable.findFirst({
		where: { key: REGISTRATION_ENABLED_KEY },
	});

	if (result?.value !== "true" && existingUser) {
		logger.info("User registration attempt blocked: registrations are not enabled.");
		throw new ForbiddenError("User registrations are currently disabled. Please contact an administrator for access.");
	}
};
