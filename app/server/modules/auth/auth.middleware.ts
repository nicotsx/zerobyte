import { createMiddleware } from "hono/factory";
import { auth } from "~/lib/auth";

declare module "hono" {
	interface ContextVariableMap {
		user: {
			id: string;
			username: string;
			hasDownloadedResticPassword: boolean;
		};
	}
}

/**
 * Middleware to require authentication
 * Verifies the session cookie and attaches user to context
 */
export const requireAuth = createMiddleware(async (c, next) => {
	const session = await auth.api.getSession({
		headers: c.req.raw.headers,
	});

	const { user } = session ?? {};

	if (!user) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	if (user.role !== "admin") {
		// For now we only have admin users
		return c.json<unknown>({ message: "Insufficient permissions" }, 403);
	}

	c.set("user", user);

	await next();
});
