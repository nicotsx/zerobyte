import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { account, usersTable } from "~/server/db/schema";
import { createTestSession } from "~/test/helpers/auth";
import { DESKTOP_LAUNCH_SECRET_HEADER } from "../desktop.service";
import { DESKTOP_USER_EMAIL } from "../constants";

const app = createApp();
const launchSecret = "s".repeat(32);

afterEach(() => {
	config.runtime = "server";
	config.desktop.launchSecret = undefined;
});

const useDesktopRuntime = () => {
	config.runtime = "desktop";
	config.desktop.launchSecret = launchSecret;
};

const createDesktopSessionCookie = async () => {
	useDesktopRuntime();

	const res = await app.request("/api/v1/desktop/session", {
		method: "POST",
		headers: {
			[DESKTOP_LAUNCH_SECRET_HEADER]: launchSecret,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ dateFormat: "DD/MM/YYYY", timeFormat: "24h" }),
	});
	const cookie = res.headers.get("set-cookie")?.split(";")[0];
	const body = (await res.clone().json()) as { token: string };

	expect(res.status).toBe(200);
	expect(cookie).toBeTruthy();

	return { cookie: cookie ?? "", token: body.token };
};

const expectSessionCookieCleared = (res: Response) => {
	const setCookie = res.headers.get("set-cookie");
	expect(setCookie).toContain("zerobyte.session_token=");
	expect(setCookie).toContain("Max-Age=0");
};

describe("desktopController", () => {
	test("rejects desktop session requests without the launch secret", async () => {
		useDesktopRuntime();

		const res = await app.request("/api/v1/desktop/session", {
			method: "POST",
		});

		expect(res.status).toBe(401);
	});

	test("rejects desktop session requests outside desktop runtime", async () => {
		config.desktop.launchSecret = launchSecret;

		const res = await app.request("/api/v1/desktop/session", {
			method: "POST",
			headers: {
				[DESKTOP_LAUNCH_SECRET_HEADER]: launchSecret,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ dateFormat: "DD/MM/YYYY", timeFormat: "24h" }),
		});

		expect(res.status).toBe(400);
	});

	test("creates a desktop-scoped session cookie when the launch secret is valid", async () => {
		useDesktopRuntime();
		await db
			.update(usersTable)
			.set({ hasDownloadedResticPassword: false })
			.where(eq(usersTable.email, DESKTOP_USER_EMAIL));

		const res = await app.request("/api/v1/desktop/session", {
			method: "POST",
			headers: {
				[DESKTOP_LAUNCH_SECRET_HEADER]: launchSecret,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ dateFormat: "DD/MM/YYYY", timeFormat: "24h" }),
		});

		expect(res.status).toBe(200);
		expect(res.headers.get("set-cookie")).toContain("zerobyte.session_token");
		const body = (await res.clone().json()) as { token: string };

		const desktopUser = await db.query.usersTable.findFirst({
			where: { email: DESKTOP_USER_EMAIL },
		});
		const desktopAuthSession = await db.query.sessionsTable.findFirst({
			where: { token: body.token },
		});
		expect(desktopUser?.hasDownloadedResticPassword).toBe(false);
		expect(desktopAuthSession?.authSource).toBe("desktop-session");
	});

	test("rejects reserved desktop users that do not have the derived desktop credential", async () => {
		useDesktopRuntime();
		await db.delete(usersTable).where(eq(usersTable.email, DESKTOP_USER_EMAIL));

		const userId = crypto.randomUUID();
		try {
			await db.insert(usersTable).values({
				id: userId,
				username: `desktop-collision-${crypto.randomUUID()}`,
				name: "Desktop Collision",
				email: DESKTOP_USER_EMAIL,
			});
			await db.insert(account).values({
				id: crypto.randomUUID(),
				accountId: DESKTOP_USER_EMAIL,
				providerId: "credential",
				userId,
				password: await hashPassword("wrong-password"),
			});

			const res = await app.request("/api/v1/desktop/session", {
				method: "POST",
				headers: {
					[DESKTOP_LAUNCH_SECRET_HEADER]: launchSecret,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ dateFormat: "DD/MM/YYYY", timeFormat: "24h" }),
			});

			expect(res.status).toBe(401);
			expect(await db.query.sessionsTable.findFirst({ where: { userId } })).toBeUndefined();
		} finally {
			await db.delete(usersTable).where(eq(usersTable.email, DESKTOP_USER_EMAIL));
		}
	});

	test("does not treat desktop sessions as browser sessions for admin routes", async () => {
		const v1Session = await createDesktopSessionCookie();
		config.runtime = "server";

		const adminRes = await app.request("/api/v1/auth/admin-users", {
			headers: {
				Cookie: v1Session.cookie,
			},
		});

		expect(adminRes.status).toBe(401);
		expectSessionCookieCleared(adminRes);
		expect(await db.query.sessionsTable.findFirst({ where: { token: v1Session.token } })).toBeUndefined();

		const directSession = await createDesktopSessionCookie();
		config.runtime = "server";
		const directSessionRes = await app.request("/api/auth/get-session", {
			headers: {
				Cookie: directSession.cookie,
			},
		});

		expect(directSessionRes.status).toBe(401);
		expectSessionCookieCleared(directSessionRes);
		expect(await db.query.sessionsTable.findFirst({ where: { token: directSession.token } })).toBeUndefined();

		const betterAuthAdminSession = await createDesktopSessionCookie();
		config.runtime = "server";
		const betterAuthAdminRes = await app.request("/api/auth/admin/list-users", {
			headers: {
				Cookie: betterAuthAdminSession.cookie,
			},
		});

		expect(betterAuthAdminRes.status).toBe(401);
		expectSessionCookieCleared(betterAuthAdminRes);
		expect(
			await db.query.sessionsTable.findFirst({ where: { token: betterAuthAdminSession.token } }),
		).toBeUndefined();
	});

	test("does not allow browser sessions to self-mark as desktop sessions", async () => {
		const session = await createTestSession();

		const res = await app.request("/api/auth/update-session", {
			method: "POST",
			headers: {
				...session.headers,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ authSource: "desktop-session" }),
		});

		expect(res.status).toBe(400);

		const storedSession = await db.query.sessionsTable.findFirst({
			where: { token: session.session.token },
		});
		expect(storedSession?.authSource).toBe("browser-session");
	});
});
