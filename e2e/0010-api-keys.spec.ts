import { expect } from "@playwright/test";
import { prepareAuthTests, test } from "./helpers/auth";
import { gotoAndWaitForAppReady } from "./helpers/page";

test.describe.configure({ mode: "default" });
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(prepareAuthTests);

test("creates an API key in the UI, authenticates without cookies, and rejects it after revocation", async ({
	page,
	authUser,
	playwright,
	baseURL,
}) => {
	await gotoAndWaitForAppReady(page, "/settings");
	await page.getByRole("button", { name: "Create key", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Create API key", exact: true });
	await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Browser test");
	await dialog.getByRole("textbox", { name: "Current password", exact: true }).fill(authUser.password);
	await dialog.getByRole("button", { name: "Create", exact: true }).click();
	const created = page.getByRole("dialog", { name: "API key created", exact: true });
	const key = await created.getByRole("textbox", { name: "API key", exact: true }).inputValue();
	expect(key).toMatch(/^zb_/);
	await created.getByRole("button", { name: "Done", exact: true }).click();
	const client = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true });

	try {
		const authenticated = await client.get("/api/v1/volumes", { headers: { "x-api-key": key } });
		expect(authenticated.status()).toBe(200);
		const unauthenticated = await client.get("/api/v1/volumes");
		expect(unauthenticated.status()).toBe(401);

		await page.getByRole("button", { name: "Revoke API key Browser test", exact: true }).click();
		const revoked = page.waitForResponse(
			(response) => response.request().method() === "DELETE" && response.url().includes("/api-keys/"),
		);
		await page.getByRole("alertdialog").getByRole("button", { name: "Revoke", exact: true }).click();
		expect((await revoked).ok()).toBe(true);
		const rejected = await client.get("/api/v1/volumes", { headers: { "x-api-key": key } });
		expect(rejected.status()).toBe(401);
	} finally {
		await client.dispose();
	}
});
