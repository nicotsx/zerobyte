import { createMiddleware } from "hono/factory";
import { auth } from "~/server/lib/auth";
import { db } from "~/server/db/db";
import { getPermission, withContext } from "~/server/core/request-context";
import { getApiKeyOrganizationId } from "../api-keys/api-keys.service";
import type { AuthSource, Permission } from "~/lib/permission-policy";

const API_KEY_HEADER = "x-api-key";
type AuthenticatedUser = {
	id: string;
	email: string;
	username: string;
	hasDownloadedResticPassword: boolean;
	role?: string | null | undefined;
	banned?: boolean | null | undefined;
};

declare module "hono" {
	interface ContextVariableMap {
		user: AuthenticatedUser;
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
	const apiKeyValue = c.req.header(API_KEY_HEADER);
	let authSource: AuthSource = apiKeyValue ? "api-key" : "browser-session";
	let user: AuthenticatedUser | undefined;
	let activeOrganizationId: string | null | undefined;

	if (apiKeyValue && !c.req.path.startsWith("/api/v1")) {
		return c.json<unknown>({ message: "API key authentication is only supported for API v1 routes" }, 401);
	}

	if (apiKeyValue) {
		const verification = await auth.api.verifyApiKey({ body: { key: apiKeyValue } });
		const apiKey = verification?.valid ? verification.key : null;

		if (!apiKey) {
			return c.json<unknown>({ message: "Invalid or expired session" }, 401);
		}

		user = await db.query.usersTable.findFirst({ where: { id: apiKey.referenceId } });
		activeOrganizationId = await getApiKeyOrganizationId(apiKey.id);
	} else {
		const sess = await auth.api.getSession({ headers: c.req.raw.headers });

		if (sess) {
			user = sess.user;
			activeOrganizationId = sess.session.activeOrganizationId;
			authSource = sess.session.authSource === "desktop-session" ? "desktop-session" : "browser-session";
		}
	}

	if (!user) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

	if (authSource === "api-key" && user.banned) {
		return c.json<unknown>({ message: "Invalid or expired session" }, 401);
	}

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

	await withContext(
		{
			organizationId: activeOrganizationId,
			userId: user.id,
			instanceRole: user.role,
			orgRole: membership.role,
			authSource,
		},
		async () => {
			await next();
		},
	);
});

export const requireBrowserSession = createMiddleware(async (c, next) => {
	if (c.get("authSource") !== "browser-session") {
		return c.json({ message: "Browser session required" }, 401);
	}

	await next();
});

export const requirePermission = (permission: Permission) =>
	createMiddleware(async (c, next) => {
		const result = getPermission(permission);

		if (result.allowed) {
			await next();
			return;
		}

		if (result.reason === "runtime") {
			return c.json({ message: "Not available in desktop mode" }, 403);
		}

		if (result.reason === "authSource") {
			return c.json({ message: "Browser session required" }, 401);
		}

		return c.json({ message: "Forbidden" }, 403);
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
	if (c.get("authSource") !== "browser-session") {
		return c.json({ message: "Browser session required" }, 401);
	}

	const user = c.get("user");

	if (!user || user.role !== "admin") {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});
