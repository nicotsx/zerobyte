import { db } from "~/server/db/db";
import type { AuthMiddlewareContext } from "../auth";
import { logger } from "~/server/utils/logger";

export const ensureOnlyOneUser = async (ctx: AuthMiddlewareContext) => {
	const { path } = ctx;

	if (path !== "/sign-up/email") {
		return;
	}

	const existingUser = await db.query.usersTable.findFirst();
	if (existingUser) {
		logger.error("Attempt to create a second administrator account blocked.");
		throw new Error("An administrator account already exists");
	}
};
