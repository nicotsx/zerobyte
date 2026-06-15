import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { sessionsTable, usersTable } from "~/server/db/schema";
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

	test("does not treat desktop sessions as browser sessions for admin routes", async () => {
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
		expect(cookie).toBeTruthy();

		config.runtime = "server";

		const adminRes = await app.request("/api/v1/auth/admin-users", {
			headers: {
				Cookie: cookie ?? "",
			},
		});

		expect(adminRes.status).toBe(401);
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
