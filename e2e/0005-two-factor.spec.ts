import type { Browser, Page } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import path from "node:path";
import { expect, test } from "./test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const twoFactorPassword = "password123";

async function createTwoFactorUser(browser: Browser, username: string) {
	const context = await browser.newContext({
		baseURL: `http://${process.env.SERVER_IP}:4096`,
		storageState: { cookies: [], origins: [] },
	});
	const page = await context.newPage();

	await gotoAndWaitForAppReady(page, "/onboarding");
	await page.getByRole("textbox", { name: "Email" }).fill(`${username}@example.com`);
	await page.getByRole("textbox", { name: "Username" }).fill(username);
	await page.getByRole("textbox", { name: "Password", exact: true }).fill(twoFactorPassword);
	await page.getByRole("textbox", { name: "Confirm Password" }).fill(twoFactorPassword);
	await page.getByRole("button", { name: "Create admin user" }).click();
	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill(twoFactorPassword);
	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();
	const download = await downloadPromise;
	await download.saveAs(path.join(process.cwd(), "playwright", `restic-${username}.pass`));
	await expect(page).toHaveURL("/volumes");

	return { context, page };
}

async function generateTotp(secret: string) {
	const decodedSecret = new TextDecoder().decode(base32.decode(secret));
	return createOTP(decodedSecret).totp();
}

async function fillOtp(page: Page, code: string) {
	await page.locator('[data-slot="input-otp"]').click();
	await page.keyboard.type(code);
}

test("user can enable 2FA and sign in with a TOTP code", async ({ browser }, testInfo) => {
	const username = `e2e-2fa-${testInfo.parallelIndex}-${testInfo.retry}`;
	const { context, page: twoFactorPage } = await createTwoFactorUser(browser, username);

	try {
		await gotoAndWaitForAppReady(twoFactorPage, "/settings");

		await twoFactorPage.getByRole("button", { name: "Enable 2FA" }).click();
		await twoFactorPage.getByRole("textbox", { name: "Password" }).fill(twoFactorPassword);
		await twoFactorPage.getByRole("button", { name: "Continue" }).click();

		await expect(twoFactorPage.getByRole("heading", { name: "Scan QR Code" })).toBeVisible();
		const secret = await twoFactorPage.locator("input[readonly]").inputValue();

		await twoFactorPage.getByRole("button", { name: "Continue" }).click();
		await expect(twoFactorPage.getByRole("heading", { name: "Verify setup" })).toBeVisible();

		await fillOtp(twoFactorPage, await generateTotp(secret));

		await expect(twoFactorPage.getByText(/Status:\s*Enabled/)).toBeVisible();

		await context.clearCookies();
		await gotoAndWaitForAppReady(twoFactorPage, "/login");

		const usernameInput = twoFactorPage.getByRole("textbox", { name: "Username" });
		await usernameInput.fill(username);
		await expect(usernameInput).toHaveValue(username);
		await twoFactorPage.getByRole("textbox", { name: "Password" }).fill(twoFactorPassword);
		await twoFactorPage.getByRole("button", { name: "Login" }).click();

		await expect(twoFactorPage.getByRole("heading", { name: "Two-Factor Authentication" })).toBeVisible();

		await fillOtp(twoFactorPage, await generateTotp(secret));

		await expect(twoFactorPage).toHaveURL("/volumes");
		await expect(twoFactorPage.getByRole("button", { name: "Create Volume" })).toBeVisible();
	} finally {
		await context.close();
	}
});
