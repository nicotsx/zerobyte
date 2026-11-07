import { expect } from "@playwright/test";
import { expectSignedIn, prepareAuthTests, signInWithPassword, test } from "./helpers/auth";
import { gotoAndWaitForAppReady } from "./helpers/page";

test.describe.configure({ mode: "default" });
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(prepareAuthTests);

test("password login survives reload and logout revokes the browser session", async ({ page, authUser }) => {
	await page.context().clearCookies();
	await signInWithPassword(page, authUser);
	await expectSignedIn(page, authUser.username);
	const sessionCookies = await page.context().cookies();

	await page.getByRole("button", { name: "Logout", exact: true }).click();
	await expect(page).toHaveURL(/\/login$/);
	await page.context().addCookies(sessionCookies);
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
	await gotoAndWaitForAppReady(page, "/settings");
	await expect(page).toHaveURL(/\/login$/);
});

test("rejects an incorrect password and permits a subsequent correct login", async ({ page, authUser }) => {
	await page.context().clearCookies();
	await signInWithPassword(page, { ...authUser, password: "incorrect-password" });
	await expect(page.getByText("Login failed", { exact: true })).toBeVisible();
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();

	await signInWithPassword(page, authUser);
	await expectSignedIn(page, authUser.username);
});
