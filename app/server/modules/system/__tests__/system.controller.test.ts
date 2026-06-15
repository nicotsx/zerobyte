import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createApp } from "~/server/app";
import { createTestSession, createTestSessionWithGlobalAdmin, getAuthHeaders } from "~/test/helpers/auth";
import { systemService } from "../system.service";
import * as authHelpers from "~/server/modules/auth/helpers";
import { db } from "~/server/db/db";
import { organization, sessionsTable, usersTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { cryptoUtils } from "~/server/utils/crypto";
import { config } from "~/server/core/config";

const app = createApp();

let session: Awaited<ReturnType<typeof createTestSession>>;
let globalAdminSession: Awaited<ReturnType<typeof createTestSessionWithGlobalAdmin>>;

const createDesktopTestSession = async () => {
	const desktopAuthSession = await createTestSession();
	await db
		.update(sessionsTable)
		.set({ authSource: "desktop-session" })
		.where(eq(sessionsTable.token, desktopAuthSession.session.token));
	return desktopAuthSession;
};

beforeAll(async () => {
	session = await createTestSession();
	globalAdminSession = await createTestSessionWithGlobalAdmin();
});

afterEach(() => {
	config.runtime = "server";
	vi.restoreAllMocks();
});

describe("system security", () => {
	test("should return 401 if no session cookie is provided", async () => {
		const res = await app.request("/api/v1/system/info");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 401 if session is invalid", async () => {
		const res = await app.request("/api/v1/system/info", {
			headers: getAuthHeaders("invalid-session"),
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.message).toBe("Invalid or expired session");
	});

	test("should return 200 if session is valid", async () => {
		const res = await app.request("/api/v1/system/info", {
			headers: session.headers,
		});

		expect(res.status).toBe(200);
	});

	test("returns desktop runtime and effective backend lists in desktop mode", async () => {
		config.runtime = "desktop";

		try {
			const res = await app.request("/api/v1/system/info", {
				headers: session.headers,
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toMatchObject({
				runtime: "desktop",
				capabilities: {
					volumeBackends: ["directory"],
					repositoryBackends: ["local", "s3", "r2", "gcs", "azure", "sftp", "rest"],
				},
			});
		} finally {
			config.runtime = "server";
		}
	});

	describe("unauthenticated access", () => {
		const endpoints: { method: string; path: string }[] = [
			{ method: "GET", path: "/api/v1/system/info" },
			{ method: "GET", path: "/api/v1/system/updates" },
			{ method: "GET", path: "/api/v1/system/registration-status" },
			{ method: "PUT", path: "/api/v1/system/registration-status" },
			{ method: "POST", path: "/api/v1/system/restic-password" },
			{ method: "GET", path: "/api/v1/system/dev-panel" },
		];

		for (const { method, path } of endpoints) {
			test(`${method} ${path} should return 401`, async () => {
				const res = await app.request(path, { method });
				expect(res.status).toBe(401);
				const body = await res.json();
				expect(body.message).toBe("Invalid or expired session");
			});
		}
	});

	describe("registration-status endpoint", () => {
		test("GET /api/v1/system/registration-status should be accessible with valid session", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				headers: session.headers,
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});

		test("PUT /api/v1/system/registration-status should return 403 for non-admin users", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.message).toBe("Forbidden");
		});

		test("PUT /api/v1/system/registration-status should be accessible to global admin", async () => {
			const res = await app.request("/api/v1/system/registration-status", {
				method: "PUT",
				headers: {
					...globalAdminSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ enabled: false }),
			});
			expect(res.status).toBe(200);
		});
	});

	describe("dev-panel endpoint", () => {
		test("GET /api/v1/system/dev-panel should be accessible with valid session", async () => {
			const res = await app.request("/api/v1/system/dev-panel", { headers: session.headers });
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(typeof body.enabled).toBe("boolean");
		});
	});

	describe("updates endpoint", () => {
		test("GET /api/v1/system/updates should be accessible with valid session", async () => {
			const expectedUpdates = {
				currentVersion: "1.0.0",
				latestVersion: "1.0.0",
				hasUpdate: false,
				missedReleases: [],
			};

			vi.spyOn(systemService, "getUpdates").mockResolvedValue({
				...expectedUpdates,
			});

			const res = await app.request("/api/v1/system/updates", { headers: session.headers });
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(expectedUpdates);
		});
	});

	describe("input validation", () => {
		test("should return complete decrypted restic password content", async () => {
			const { cryptoUtils: actualCryptoUtils } =
				await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
			const resticPassword = "correct-restic-passwordb";
			const encryptedResticPassword = await actualCryptoUtils.sealSecret(resticPassword);

			await db
				.update(organization)
				.set({ metadata: { resticPassword: encryptedResticPassword } })
				.where(eq(organization.id, session.organizationId));
			vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
			vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(true);
			vi.spyOn(cryptoUtils, "resolveSecret").mockImplementationOnce(actualCryptoUtils.resolveSecret);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "password",
				}),
			});

			expect(res.status).toBe(200);
			expect(res.headers.get("Content-Type")).toContain("text/plain");
			expect(await res.text()).toBe(resticPassword);
		});

		test("should download restic password without password re-authentication for desktop sessions", async () => {
			config.runtime = "desktop";
			const desktopAuthSession = await createDesktopTestSession();
			const { cryptoUtils: actualCryptoUtils } =
				await vi.importActual<typeof import("~/server/utils/crypto")>("~/server/utils/crypto");
			const resticPassword = "desktop-restic-password";
			const encryptedResticPassword = await actualCryptoUtils.sealSecret(resticPassword);
			const verifyPasswordSpy = vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			await db
				.update(organization)
				.set({ metadata: { resticPassword: encryptedResticPassword } })
				.where(eq(organization.id, desktopAuthSession.organizationId));
			await db
				.update(usersTable)
				.set({ hasDownloadedResticPassword: false })
				.where(eq(usersTable.id, desktopAuthSession.user.id));
			vi.spyOn(cryptoUtils, "resolveSecret").mockImplementationOnce(actualCryptoUtils.resolveSecret);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...desktopAuthSession.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "",
				}),
			});

			expect(res.status).toBe(200);
			expect(await res.text()).toBe(resticPassword);
			expect(verifyPasswordSpy).not.toHaveBeenCalled();

			const updatedUser = await db.query.usersTable.findFirst({
				where: { id: desktopAuthSession.user.id },
			});
			expect(updatedUser?.hasDownloadedResticPassword).toBe(true);
		});

		test("requires password re-authentication for browser sessions in desktop mode", async () => {
			config.runtime = "desktop";
			vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
			const verifyPasswordSpy = vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			expect(verifyPasswordSpy).toHaveBeenCalledWith({
				password: "wrong-password",
				userId: session.user.id,
			});
			const body = await res.json();
			expect(body.message).toBe("Invalid password");
		});

		test("should return 400 for invalid payload on restic-password", async () => {
			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({}),
			});

			expect(res.status).toBe(400);
		});

		test("should return 401 for incorrect password on restic-password", async () => {
			vi.spyOn(authHelpers, "userHasPassword").mockResolvedValueOnce(true);
			vi.spyOn(authHelpers, "verifyUserPassword").mockResolvedValueOnce(false);

			const res = await app.request("/api/v1/system/restic-password", {
				method: "POST",
				headers: {
					...session.headers,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					password: "wrong-password",
				}),
			});

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body.message).toBe("Invalid password");
		});
	});
});
