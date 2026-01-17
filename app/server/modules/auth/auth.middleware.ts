import { createMiddleware } from "hono/factory";
import { auth } from "~/lib/auth";
import { db } from "~/server/db/db";
import { member } from "~/server/db/schema";
import { eq, and } from "drizzle-orm";

declare module "hono" {
	interface ContextVariableMap {
		user: {
			id: string;
			username: string;
			hasDownloadedResticPassword: boolean;
			role?: string | null | undefined;
		};
		organizationId: string;
	}
}

/**
 * Middleware to require authentication
 * Verifies the session cookie and attaches user to context
 */
export const requireAuth = createMiddleware(async (c, next) => {
	const sess = await auth.api.getSession({
		headers: c.req.raw.headers,
	});

	const { user, session } = sess ?? {};
	const { activeOrganizationId } = session ?? {};

	if (!user || !session || !activeOrganizationId) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	c.set("user", user);
	c.set("organizationId", activeOrganizationId);

	await next();
});

/**
 * Middleware to require organization owner or admin role
 * Verifies the user has the required role in the current organization
 */
export const requireOrgAdmin = createMiddleware(async (c, next) => {
	const user = c.get("user");
	const organizationId = c.get("organizationId");

	const membership = await db.query.member.findFirst({
		where: and(eq(member.userId, user.id), eq(member.organizationId, organizationId)),
	});

	if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});
