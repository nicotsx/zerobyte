import { createMiddleware } from "hono/factory";
import { auth } from "~/server/lib/auth";
import { db } from "~/server/db/db";
import { withContext } from "~/server/core/request-context";
import type { ApiKeyMetadata } from "~/server/db/schema";
import type { Context, Next } from "hono";

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
	}
}

const API_KEY_HEADER = "x-api-key";

const authenticateWithApiKey = async (c: Context<any, string, {}>, next: Next, apiKeyValue: string) => {
	const result = await auth.api.verifyApiKey({
		body: { key: apiKeyValue },
	});

	if (!result.valid || !result.key) {
		return c.json<unknown>({ message: "Invalid or expired API key" }, 401);
	}

	const metadata = result.key.metadata as ApiKeyMetadata | null;
	const organizationId = metadata?.organizationId;

	if (!organizationId) {
		return c.json<unknown>({ message: "Invalid organization context" }, 403);
	}

	const { referenceId: userId } = result.key as { referenceId: string };

	if (!userId) {
		return c.json<unknown>({ message: "Invalid or expired API key" }, 401);
	}

	const [user, membership] = await Promise.all([
		db.query.usersTable.findFirst({ where: { id: userId } }),
		db.query.member.findFirst({
			where: {
				AND: [{ userId }, { organizationId }],
			},
		}),
	]);

	if (!user) {
		return c.json<unknown>({ message: "Invalid or expired API key" }, 401);
	}

	if (!membership) {
		return c.json<unknown>({ message: "Invalid organization context" }, 403);
	}

	c.set("user", user);
	c.set("organizationId", organizationId);
	c.set("membership", { role: membership.role });

	await withContext({ organizationId, userId: user.id }, async () => {
		await next();
	});
};

const authenticWithSession = async (c: Context<any, string, {}>, next: Next) => {
	const sess = await auth.api.getSession({
		headers: c.req.raw.headers,
	});

	const { user, session } = sess ?? {};
	const { activeOrganizationId } = session ?? {};

	if (!user || !session || !activeOrganizationId) {
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

	await withContext({ organizationId: activeOrganizationId, userId: user.id }, async () => {
		await next();
	});
};

/**
 * Middleware to require authentication
 * Verifies the session cookie or `x-api-key` header and attaches user to context
 */
export const requireAuth = createMiddleware(async (c, next) => {
	const apiKeyValue = c.req.header(API_KEY_HEADER);

	if (apiKeyValue) {
		return authenticateWithApiKey(c, next, apiKeyValue);
	}

	return authenticWithSession(c, next);
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
	const user = c.get("user");

	if (!user || user.role !== "admin") {
		return c.json({ message: "Forbidden" }, 403);
	}

	await next();
});
