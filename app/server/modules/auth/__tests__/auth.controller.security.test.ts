import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "~/server/app";
import {
	createTestSession,
	createTestSessionWithGlobalAdmin,
	createTestSessionWithOrgAdmin,
	createTestSessionWithRegularMember,
	getAuthHeaders,
} from "~/test/helpers/auth";
import { account, invitation, member, organization, ssoProvider, usersTable } from "~/server/db/schema";
import { db } from "~/server/db/db";

const app = createApp();

describe("auth controller security", () => {
	beforeEach(async () => {
		await db.delete(member);
		await db.delete(account);
		await db.delete(invitation);
		await db.delete(ssoProvider);
		await db.delete(organization);
		await db.delete(usersTable);
	});

	describe("public endpoints - no auth required", () => {
		test("GET /api/v1/auth/status should be accessible without authentication", async () => {
			const res = await app.request("/api/v1/auth/status");
			expect(res.status).toBe(200);
		});

		test("GET /api/v1/auth/sso-providers should be accessible without authentication", async () => {
			const res = await app.request("/api/v1/auth/sso-providers");
			expect(res.status).toBe(200);
		});

		test("GET /api/v1/auth/login-error should be accessible without authentication", async () => {
			const res = await app.request("/api/v1/auth/login-error?error=test");
			expect(res.status).toBe(302);
		});
	});

	describe("org admin endpoints - require requireAuth + requireOrgAdmin", () => {
		const orgAdminEndpoints = [
			{ method: "GET", path: "/api/v1/auth/sso-settings" },
			{ method: "DELETE", path: "/api/v1/auth/sso-providers/test-provider" },
			{ method: "PATCH", path: "/api/v1/auth/sso-providers/test-provider/auto-linking" },
			{ method: "DELETE", path: "/api/v1/auth/sso-invitations/test-invitation" },
			{ method: "GET", path: "/api/v1/auth/org-members" },
			{ method: "PATCH", path: "/api/v1/auth/org-members/test-member/role" },
			{ method: "DELETE", path: "/api/v1/auth/org-members/test-member" },
		];

		for (const { method, path } of orgAdminEndpoints) {
			test(`${method} ${path} should return 401 when unauthenticated`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});

			test(`${method} ${path} should return 403 for regular members`, async () => {
				const { headers } = await createTestSessionWithRegularMember();
				const res = await app.request(path, {
					method,
					headers,
					body: method !== "GET" && method !== "DELETE" ? JSON.stringify({}) : undefined,
				});
				expect(res.status).toBe(403);
				const body = await res.json();
				expect(body.message).toBe("Forbidden");
			});

			test(`${method} ${path} should be accessible to org admins`, async () => {
				const { headers } = await createTestSessionWithOrgAdmin();
				const res = await app.request(path, {
					method,
					headers,
					body: method !== "GET" && method !== "DELETE" ? JSON.stringify({}) : undefined,
				});
				// Should not be 401 or 403 - actual response depends on endpoint logic
				expect(res.status).not.toBe(401);
				expect(res.status).not.toBe(403);
			});
		}

		describe("PATCH /api/v1/auth/sso-providers/:providerId/auto-linking specific", () => {
			test("should return 400 for invalid payload", async () => {
				const { headers } = await createTestSessionWithOrgAdmin();
				const res = await app.request("/api/v1/auth/sso-providers/test-provider/auto-linking", {
					method: "PATCH",
					headers: {
						...headers,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				});
				expect(res.status).toBe(400);
			});
		});

		describe("PATCH /api/v1/auth/org-members/:memberId/role specific", () => {
			test("should return 400 for invalid payload", async () => {
				const { headers } = await createTestSessionWithOrgAdmin();
				const res = await app.request("/api/v1/auth/org-members/test-member/role", {
					method: "PATCH",
					headers: {
						...headers,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({}),
				});
				expect(res.status).toBe(400);
			});
		});
	});

	describe("global admin endpoints - require requireAuth + requireAdmin", () => {
		const adminEndpoints = [
			{ method: "GET", path: "/api/v1/auth/admin-users" },
			{ method: "DELETE", path: "/api/v1/auth/admin-users/test-user/accounts/test-account" },
			{ method: "GET", path: "/api/v1/auth/deletion-impact/test-user" },
		];

		for (const { method, path } of adminEndpoints) {
			test(`${method} ${path} should return 401 when unauthenticated`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});

			test(`${method} ${path} should return 403 for regular users`, async () => {
				const { headers } = await createTestSession();
				const res = await app.request(path, { method, headers });
				expect(res.status).toBe(403);
				const body = await res.json();
				expect(body.message).toBe("Forbidden");
			});

			test(`${method} ${path} should return 403 for org admins`, async () => {
				const { headers } = await createTestSessionWithOrgAdmin();
				const res = await app.request(path, { method, headers });
				expect(res.status).toBe(403);
				const body = await res.json();
				expect(body.message).toBe("Forbidden");
			});

			test(`${method} ${path} should not return 401 for global admins`, async () => {
				const { headers } = await createTestSessionWithGlobalAdmin();
				const res = await app.request(path, { method, headers });
				// Should not be 401 - actual response depends on endpoint logic
				expect(res.status).not.toBe(401);
			});
		}

		test("global admins can delete an account for a user outside their active organization", async () => {
			const { headers } = await createTestSessionWithGlobalAdmin();
			const target = await createTestSession();

			const retainedAccountId = Bun.randomUUIDv7();
			await db.insert(account).values({
				id: retainedAccountId,
				accountId: `credential-${retainedAccountId}`,
				providerId: "credential",
				userId: target.user.id,
				password: "password-hash",
			});

			const removableAccountId = Bun.randomUUIDv7();
			await db.insert(account).values({
				id: removableAccountId,
				accountId: `oidc-${removableAccountId}`,
				providerId: "oidc-acme",
				userId: target.user.id,
			});

			const res = await app.request(`/api/v1/auth/admin-users/${target.user.id}/accounts/${removableAccountId}`, {
				method: "DELETE",
				headers,
			});

			expect(res.status).toBe(200);

			const deletedAccount = await db.query.account.findFirst({
				where: { id: removableAccountId },
				columns: { id: true },
			});

			expect(deletedAccount).toBeUndefined();
		});
	});

	describe("invalid session handling", () => {
		test("should return 401 for invalid session cookie", async () => {
			const res = await app.request("/api/v1/auth/sso-settings", {
				headers: getAuthHeaders("invalid-session-token"),
			});
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("should return 401 when session cookie is missing", async () => {
			const res = await app.request("/api/v1/auth/admin-users");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});

	describe("information disclosure", () => {
		test("should not disclose org members when unauthenticated", async () => {
			const res = await app.request("/api/v1/auth/org-members");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("should not disclose SSO settings when unauthenticated", async () => {
			const res = await app.request("/api/v1/auth/sso-settings");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});

		test("should not disclose admin users when unauthenticated", async () => {
			const res = await app.request("/api/v1/auth/admin-users");
			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid or expired session");
		});
	});
});
