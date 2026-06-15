import { beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createApp } from "~/server/app";
import { auth } from "~/server/lib/auth";
import { db } from "~/server/db/db";
import { account, apikey, member, organization, sessionsTable } from "~/server/db/schema";
import { config } from "~/server/core/config";
import {
	createTestSession,
	createTestSessionWithGlobalAdmin,
	createTestSessionWithOrgAdmin,
} from "~/test/helpers/auth";
import { randomId, randomSlug } from "~/test/helpers/user-org";

const app = createApp();

type TestSession = {
	headers: Record<string, string>;
	user: { id: string };
	organizationId: string;
};
type CreatedApiKey = {
	id: string;
	name: string | null;
	key: string;
	createdAt: string;
	expiresAt: string | null;
	lastRequestAt: string | null;
};

beforeEach(async () => {
	config.runtime = "server";
	await db.delete(apikey);
});

async function addPassword(session: TestSession, password = "correct-password") {
	await db.insert(account).values({
		id: randomId(),
		accountId: randomSlug("credential"),
		providerId: "credential",
		userId: session.user.id,
		password: await hashPassword(password),
	});
}

async function createApiKey(session: TestSession, name = randomSlug("api-key"), expiresIn?: number | null) {
	const body =
		expiresIn === undefined
			? { name, password: "correct-password" }
			: { name, password: "correct-password", expiresIn };

	const res = await app.request("/api/v1/auth/api-keys", {
		method: "POST",
		headers: {
			...session.headers,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	expect(res.status).toBe(200);
	return (await res.json()) as CreatedApiKey;
}

async function createStoredApiKey(session: TestSession, organizationId = session.organizationId) {
	return auth.api.createApiKey({
		body: {
			name: randomSlug("api-key"),
			userId: session.user.id,
			metadata: { organizationId },
			rateLimitEnabled: false,
		},
	});
}

async function createDesktopRuntimeSession() {
	config.runtime = "desktop";
	const session = await createTestSession();
	await db
		.update(sessionsTable)
		.set({ authSource: "desktop-session" })
		.where(eq(sessionsTable.token, session.session.token));
	return session;
}

describe("API keys", () => {
	test("creates and lists API keys for the current organization after password confirmation", async () => {
		const session = await createTestSession();
		await addPassword(session);

		const created = await createApiKey(session, "Nightly automation");

		expect(created.key).toEqual(expect.any(String));
		expect(created.key.startsWith("zb_")).toBe(true);
		expect(created.name).toBe("Nightly automation");
		expect(created.expiresAt).toBe(null);

		const listRes = await app.request("/api/v1/auth/api-keys", { headers: session.headers });
		expect(listRes.status).toBe(200);
		const body = (await listRes.json()) as {
			apiKeys: Array<{
				id: string;
				name: string | null;
				createdAt: string;
				expiresAt: string | null;
				lastRequestAt: string | null;
				key?: string;
			}>;
			limit: number;
		};

		expect(body.limit).toBe(50);
		expect(body.apiKeys).toEqual([
			{
				id: created.id,
				name: "Nightly automation",
				createdAt: created.createdAt,
				expiresAt: null,
				lastRequestAt: null,
			},
		]);
		expect(body.apiKeys[0]).not.toHaveProperty("key");
	});

	test("creates API keys with an optional expiration", async () => {
		const session = await createTestSession();
		await addPassword(session);

		const expiresIn = 30 * 24 * 60 * 60;
		const created = await createApiKey(session, "Monthly automation", expiresIn);

		expect(created.expiresAt).toEqual(expect.any(String));

		const listRes = await app.request("/api/v1/auth/api-keys", { headers: session.headers });
		expect(listRes.status).toBe(200);
		const body = (await listRes.json()) as { apiKeys: Array<{ id: string; expiresAt: string | null }> };

		expect(body.apiKeys).toContainEqual(expect.objectContaining({ id: created.id, expiresAt: created.expiresAt }));
	});

	test("rejects API key creation when the same request has the wrong password", async () => {
		const session = await createTestSession();
		await addPassword(session);

		const res = await app.request("/api/v1/auth/api-keys", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Wrong password", password: "wrong-password" }),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Invalid password" });
		expect(await db.query.apikey.findMany({ where: { referenceId: session.user.id } })).toHaveLength(0);
	});

	test("blocks API key creation for users without a local password", async () => {
		const session = await createTestSession();

		const res = await app.request("/api/v1/auth/api-keys", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "SSO-only key", password: "correct-password" }),
		});

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			message: "A local password is required to create API keys",
		});
	});

	test("rejects browser sessions in desktop runtime", async () => {
		config.runtime = "desktop";
		const session = await createTestSession();

		const res = await app.request("/api/v1/auth/api-keys", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Desktop key", password: "" }),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			message: "Invalid or expired session",
		});
	});

	test("does not expose API key endpoints when the runtime feature is unavailable", async () => {
		const session = await createDesktopRuntimeSession();

		const res = await app.request("/api/v1/auth/api-keys", {
			headers: session.headers,
		});

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ message: "Not available in desktop mode" });
	});

	test("enforces the per-user API key limit", async () => {
		const session = await createTestSession();
		await addPassword(session);

		for (let index = 0; index < 50; index++) {
			await createStoredApiKey(session);
		}

		const res = await app.request("/api/v1/auth/api-keys", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Over limit", password: "correct-password" }),
		});

		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ message: "API key limit reached" });
	});

	test("does not list expired or disabled API keys", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const storedKeys: Array<Awaited<ReturnType<typeof createStoredApiKey>>> = [];

		for (let index = 0; index < 10; index++) {
			storedKeys.push(await createStoredApiKey(session));
		}

		for (const key of storedKeys.slice(0, 5)) {
			await db
				.update(apikey)
				.set({ expiresAt: new Date(Date.now() - 60_000) })
				.where(eq(apikey.id, key.id));
		}

		for (const key of storedKeys.slice(5)) {
			await db.update(apikey).set({ enabled: false }).where(eq(apikey.id, key.id));
		}

		const created = await createApiKey(session, "Replacement key");

		expect(created.name).toBe("Replacement key");

		const listRes = await app.request("/api/v1/auth/api-keys", { headers: session.headers });
		expect(listRes.status).toBe(200);
		const body = (await listRes.json()) as { apiKeys: Array<{ id: string }> };
		expect(body.apiKeys.map((apiKey) => apiKey.id)).toEqual([created.id]);
	});

	test("does not allow direct Better Auth session lookup with API keys", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		const directSession = await auth.api.getSession({
			headers: new Headers({ "x-api-key": created.key }),
		});

		expect(directSession).toBeNull();
	});

	test("does not allow API keys to access global admin endpoints", async () => {
		const session = await createTestSessionWithGlobalAdmin();
		await addPassword(session);
		const created = await createApiKey(session);

		const res = await app.request("/api/v1/auth/admin-users", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Browser session required" });
	});

	test("does not allow API keys to execute dev panel commands", async () => {
		const session = await createTestSessionWithOrgAdmin();
		await addPassword(session);
		const created = await createApiKey(session);

		const res = await app.request("/api/v1/repositories/test-repo/exec", {
			method: "POST",
			headers: {
				"x-api-key": created.key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ command: "version" }),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Browser session required" });
	});

	test("does not allow API keys to access SSO settings", async () => {
		const session = await createTestSessionWithOrgAdmin();
		await addPassword(session);
		const created = await createApiKey(session);

		const res = await app.request("/api/v1/auth/sso-settings", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Browser session required" });
	});

	test("does not allow API keys to access SSO invitation browser flow routes", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		const routes = [
			{ method: "GET", path: "/api/v1/auth/sso-invitations" },
			{
				method: "POST",
				path: "/api/v1/auth/sso-invitations/test-invitation/verify",
				body: { providerId: "test-provider" },
			},
		];

		for (const route of routes) {
			const res = await app.request(route.path, {
				method: route.method,
				headers: {
					"x-api-key": created.key,
					"Content-Type": "application/json",
				},
				body: route.body ? JSON.stringify(route.body) : undefined,
			});

			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ message: "Browser session required" });
		}
	});

	test("does not expose SSO invitation browser flow routes when the runtime feature is unavailable", async () => {
		const session = await createDesktopRuntimeSession();

		const routes = [
			{ method: "GET", path: "/api/v1/auth/sso-invitations" },
			{
				method: "POST",
				path: "/api/v1/auth/sso-invitations/test-invitation/verify",
				body: { providerId: "test-provider" },
			},
		];

		for (const route of routes) {
			const res = await app.request(route.path, {
				method: route.method,
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: route.body ? JSON.stringify(route.body) : undefined,
			});

			expect(res.status).toBe(403);
			expect(await res.json()).toEqual({ message: "Not available in desktop mode" });
		}
	});

	test("does not allow API keys to mutate SSO admin resources", async () => {
		const session = await createTestSessionWithOrgAdmin();
		await addPassword(session);
		const created = await createApiKey(session);

		const routes = [
			{ method: "DELETE", path: "/api/v1/auth/sso-providers/test-provider" },
			{
				method: "PATCH",
				path: "/api/v1/auth/sso-providers/test-provider/auto-linking",
				body: { enabled: true },
			},
			{ method: "DELETE", path: "/api/v1/auth/sso-invitations/test-invitation" },
		];

		for (const route of routes) {
			const res = await app.request(route.path, {
				method: route.method,
				headers: {
					"x-api-key": created.key,
					"Content-Type": "application/json",
				},
				body: route.body ? JSON.stringify(route.body) : undefined,
			});

			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ message: "Browser session required" });
		}
	});

	test("authenticates API v1 requests with the key's bound organization", async () => {
		const session = await createTestSession();
		await addPassword(session);
		await db
			.update(member)
			.set({ role: "owner" })
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, session.organizationId)));

		const created = await createApiKey(session);
		const otherOrgId = randomId();
		await db.insert(organization).values({
			id: otherOrgId,
			name: "Other Org",
			slug: randomSlug("other-org"),
			createdAt: new Date(),
		});
		await db.insert(member).values({
			id: randomId(),
			organizationId: otherOrgId,
			userId: session.user.id,
			role: "owner",
			createdAt: new Date(),
		});
		const otherSession = await createTestSession();
		await db.insert(member).values({
			id: randomId(),
			organizationId: otherOrgId,
			userId: otherSession.user.id,
			role: "member",
			createdAt: new Date(),
		});
		await db
			.update(sessionsTable)
			.set({ activeOrganizationId: otherOrgId })
			.where(eq(sessionsTable.userId, session.user.id));

		const res = await app.request("/api/v1/auth/org-members", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { members: Array<{ userId: string }> };
		expect(body.members.map((m) => m.userId)).toEqual([session.user.id]);
	});

	test("does not allow API keys on Better Auth endpoints", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		const res = await app.request("/api/auth/get-session", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			message: "API key authentication is only supported for API v1 routes",
		});
	});

	test("does not expose Better Auth's direct API key management endpoints", async () => {
		const session = await createTestSession();

		const res = await app.request("/api/auth/api-key/create", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name: "Bypass attempt" }),
		});

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			message: "API key management is only supported through API v1 routes",
		});
		expect(await db.query.apikey.findMany({ where: { referenceId: session.user.id } })).toHaveLength(0);
	});

	test("does not allow API keys to download the recovery key", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		const res = await app.request("/api/v1/system/restic-password", {
			method: "POST",
			headers: {
				"x-api-key": created.key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ password: "correct-password" }),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Browser session required" });
	});

	test("revoked API keys fail future requests", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		const deleteRes = await app.request(`/api/v1/auth/api-keys/${created.id}`, {
			method: "DELETE",
			headers: session.headers,
		});
		expect(deleteRes.status).toBe(200);

		const res = await app.request("/api/v1/system/info", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ message: "Invalid or expired session" });
	});

	test("API keys fail after the user is removed from the bound organization", async () => {
		const session = await createTestSession();
		await addPassword(session);
		const created = await createApiKey(session);

		await db
			.delete(member)
			.where(and(eq(member.userId, session.user.id), eq(member.organizationId, session.organizationId)));

		const res = await app.request("/api/v1/system/info", {
			headers: { "x-api-key": created.key },
		});

		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ message: "Invalid organization context" });
	});
});
