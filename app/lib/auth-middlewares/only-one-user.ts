import { db } from "~/server/db/db";
import type { AuthMiddlewareContext } from "../auth";
import { logger } from "~/server/utils/logger";
import { eq } from "drizzle-orm";
import { appMetadataTable } from "~/server/db/schema";
import { ForbiddenError } from "http-errors-enhanced";

export const REGISTRATION_DISABLED_KEY = "registrationsDisabled";

export const ensureOnlyOneUser = async (ctx: AuthMiddlewareContext) => {
	const { path } = ctx;
	const existingUser = await db.query.usersTable.findFirst();

	if (path !== "/sign-up/email") {
		return;
	}

	const result = await db.query.appMetadataTable.findFirst({
		where: eq(appMetadataTable.key, REGISTRATION_DISABLED_KEY),
	});

	if (result?.value === "true" && existingUser) {
		logger.info("User registration attempt blocked: registrations are disabled.");
		throw new ForbiddenError("User registrations are currently disabled. Please contact an administrator for access.");
	}
};
