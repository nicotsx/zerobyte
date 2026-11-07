import { randomUUID } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page, type PlaywrightWorkerArgs } from "@playwright/test";
import { gotoAndWaitForAppReady } from "./page";

const password = "authentication-test-password";

async function createAccount(request: APIRequestContext, baseURL: string) {
	const username = `pw-${randomUUID().slice(0, 12)}`;
	const response = await request.post("/api/auth/sign-up/email", {
		headers: { Origin: baseURL },
		data: { name: username, username, email: `${username}@example.com`, password },
	});

	expect(response.ok(), await response.text()).toBe(true);
	return { username, password };
}

export async function enableTestRegistrations(request: APIRequestContext, baseURL: string) {
	const status = await request.get("/api/v1/auth/status");
	expect(status.ok()).toBe(true);
	const { hasUsers } = await status.json();
	if (hasUsers) return;

	await createAccount(request, baseURL);
	const response = await request.put("/api/v1/system/registration-status", {
		headers: { Origin: baseURL },
		data: { enabled: true },
	});

	expect(response.ok(), await response.text()).toBe(true);
}

export async function prepareAuthTests({
	playwright,
	baseURL,
}: Pick<PlaywrightWorkerArgs, "playwright"> & { baseURL?: string }) {
	if (!baseURL) throw new Error("Authentication tests require a baseURL.");
	const request = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });

	try {
		await enableTestRegistrations(request, baseURL);
	} finally {
		await request.dispose();
	}
}

export const test = base.extend<{ authUser: { username: string; password: string } }>({
	authUser: async ({ page, baseURL }, use) => {
		if (!baseURL) throw new Error("Authentication tests require a baseURL.");
		const user = await createAccount(page.request, baseURL);
		const response = await page.request.post("/api/v1/system/restic-password", {
			headers: { Origin: baseURL },
			data: { password },
		});

		expect(response.ok(), await response.text()).toBe(true);
		await use(user);
	},
});

export async function signInWithPassword(page: Page, user: { username: string; password: string }) {
	await gotoAndWaitForAppReady(page, "/login");
	await page.getByRole("textbox", { name: "Username" }).fill(user.username);
	await page.getByRole("textbox", { name: "Password", exact: true }).fill(user.password);
	await page.getByRole("button", { name: "Login", exact: true }).click();
}

export async function expectSignedIn(page: Page, username: string) {
	await expect(page).toHaveURL(/\/volumes$/);
	await page.reload();
	const response = await page.request.get("/api/auth/get-session");

	expect(response.ok()).toBe(true);
	expect(await response.json()).toMatchObject({ user: { username } });
	await expect(page.getByRole("button", { name: "Create Source" })).toBeVisible();
}
