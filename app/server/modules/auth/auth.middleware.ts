import { createMiddleware } from "hono/factory";
import { auth } from "~/lib/auth";

declare module "hono" {
	interface ContextVariableMap {
		user: {
			id: string;
			username: string;
			hasDownloadedResticPassword: boolean;
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
