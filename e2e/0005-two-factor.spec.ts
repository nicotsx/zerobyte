import type { Page } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { expect, test } from "./test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const workerPassword = "password123";

async function generateTotp(secret: string) {
	const decodedSecret = new TextDecoder().decode(base32.decode(secret));
	return createOTP(decodedSecret).totp();
}

async function fillOtp(page: Page, code: string) {
	await page.locator('[data-slot="input-otp"]').click();
	await page.keyboard.type(code);
}

test("user can enable 2FA and sign in with a TOTP code", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/settings");

	const username = await page.locator("#username").inputValue();

	await page.getByRole("button", { name: "Enable 2FA" }).click();
	await page.getByRole("textbox", { name: "Password" }).fill(workerPassword);
	await page.getByRole("button", { name: "Continue" }).click();

	await expect(page.getByRole("heading", { name: "Scan QR Code" })).toBeVisible();
	const secret = await page.locator("input[readonly]").inputValue();

	await page.getByRole("button", { name: "Continue" }).click();
	await expect(page.getByRole("heading", { name: "Verify setup" })).toBeVisible();

	await fillOtp(page, await generateTotp(secret));

	await expect(page.getByText(/Status:\s*Enabled/)).toBeVisible();

	await page.context().clearCookies();
	await gotoAndWaitForAppReady(page, "/login");

	await page.getByRole("textbox", { name: "Username" }).fill(username);
	await page.getByRole("textbox", { name: "Password" }).fill(workerPassword);
	await page.getByRole("button", { name: "Login" }).click();

	await expect(page.getByRole("heading", { name: "Two-Factor Authentication" })).toBeVisible();

	await fillOtp(page, await generateTotp(secret));

	await expect(page).toHaveURL("/volumes");
	await expect(page.getByRole("button", { name: "Create Volume" })).toBeVisible();
});
