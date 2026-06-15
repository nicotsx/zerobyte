import { afterEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "~/server/app";
import { config } from "~/server/core/config";
import { db } from "~/server/db/db";
import { usersTable } from "~/server/db/schema";
import { DESKTOP_LAUNCH_SECRET_HEADER } from "../desktop.service";
import { DESKTOP_USER_EMAIL } from "../bootstrap";

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

	test("creates a normal session cookie when the launch secret is valid", async () => {
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

		const desktopUser = await db.query.usersTable.findFirst({
			where: { email: DESKTOP_USER_EMAIL },
		});
		expect(desktopUser?.hasDownloadedResticPassword).toBe(false);
	});
});
