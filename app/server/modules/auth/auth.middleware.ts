import { createMiddleware } from "hono/factory";
import { auth } from "~/server/lib/auth";
import { db } from "~/server/db/db";
import { withContext } from "~/server/core/request-context";
import { getApiKeyOrganizationId } from "../api-keys/api-keys.service";

const API_KEY_HEADER = "x-api-key";
type AuthSource = "browser-session" | "api-key";

declare module "hono" {
	interface ContextVariableMap {
		user: {
			id: string;
			email: string;
			username: string;
			hasDownloadedResticPassword: boolean;
			role?: string | null | undefined;
		};
		organizationId: string;
		membership: { role: string };
		authSource: AuthSource;
	}
}

/**
 * Middleware to require authentication
 * Verifies the session cookie and attaches user to context
 */
export const requireAuth = createMiddleware(async (c, next) => {
	const apiKey = c.req.header(API_KEY_HEADER);
	const authSource: AuthSource = apiKey ? "api-key" : "browser-session";

	if (apiKey && !c.req.path.startsWith("/api")) {
		return c.json<unknown>({ message: "API key authentication is only supported for API v1 routes" }, 401);
	}

	const sess = await auth.api.getSession({ headers: c.req.raw.headers }).catch((error) => {
		if (authSource === "api-key") {
			return null;
		}

		throw error;
	});

	const { user, session } = sess ?? {};

	if (!user || !session) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	if (authSource === "api-key" && user.banned) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	const activeOrganizationId =
		authSource === "api-key" ? await getApiKeyOrganizationId(session.id) : session.activeOrganizationId;

	if (!activeOrganizationId) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	const membership = await db.query.member.findFirst({
		where: {
			AND: [{ userId: user.id }, { organizationId: activeOrganizationId }],
		},
	});

	if (!membership) {
		return c.json({ message: "Invalid organization context" }, 403);
	}

	c.set("user", user);
	c.set("organizationId", activeOrganizationId);
	c.set("membership", membership);
	c.set("authSource", authSource);

	await withContext({ organizationId: activeOrganizationId, userId: user.id }, async () => {
		await next();
	});
});

export const requireBrowserSession = createMiddleware(async (c, next) => {
	if (c.get("authSource") === "api-key") {
		return c.json({ message: "Browser session required" }, 401);
	}

	await next();
});

/**
 * Middleware to require organization owner or admin role
 * Verifies the user has the required role in the current organization
 */
export const requireOrgAdmin = createMiddleware(async (c, next) => {
	const { role } = c.get("membership");

	if (role !== "owner" && role !== "admin") {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});

export const requireAdmin = createMiddleware(async (c, next) => {
	if (c.get("authSource") === "api-key") {
		return c.json({ message: "Browser session required" }, 401);
	}

	const user = c.get("user");

	if (!user || user.role !== "admin") {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});
