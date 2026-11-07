import { expect } from "@playwright/test";
import { expectSignedIn, prepareAuthTests, signInWithPassword, test } from "./helpers/auth";
import { gotoAndWaitForAppReady } from "./helpers/page";
import {
	enableTwoFactor,
	fillOtp,
	generateTotp,
	generateInvalidTotp,
	openTwoFactorChallenge,
} from "./helpers/two-factor";

test.describe.configure({ mode: "default" });
test.use({ storageState: { cookies: [], origins: [] } });
test.beforeAll(prepareAuthTests);

test("enrolls through the UI and signs in with a real TOTP", async ({ page, authUser }) => {
	await gotoAndWaitForAppReady(page, "/settings");
	await page.getByRole("button", { name: "Enable 2FA", exact: true }).click();
	await page.getByRole("textbox", { name: "Your password", exact: true }).fill("incorrect-password");
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByText("Failed to enable 2FA", { exact: true })).toBeVisible();

	await page.getByRole("textbox", { name: "Your password", exact: true }).fill(authUser.password);
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Scan QR Code", exact: true })).toBeVisible();
	const secret = await page.locator("input[readonly]").inputValue();
	await page.getByRole("button", { name: "Continue", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Verify setup", exact: true })).toBeVisible();
	await fillOtp(page, await generateTotp(secret));
	await expect(page.getByText(/Status:\s*Enabled/)).toBeVisible();

	await openTwoFactorChallenge(page, authUser);
	await fillOtp(page, await generateTotp(secret));
	await expectSignedIn(page, authUser.username);
});

test("rejects an incorrect TOTP without creating a session, then accepts a valid code", async ({
	page,
	authUser,
	baseURL,
}) => {
	const { secret } = await enableTwoFactor(page, authUser.password, baseURL!);
	await openTwoFactorChallenge(page, authUser);
	const wrongCode = await generateInvalidTotp(secret);
	await fillOtp(page, wrongCode);
	await expect(page.getByText("Verification failed", { exact: true })).toBeVisible();
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();

	await fillOtp(page, await generateTotp(secret));
	await expectSignedIn(page, authUser.username);
});

test("a recovery code signs in once and cannot be reused", async ({ page, authUser, baseURL }) => {
	const { backupCodes } = await enableTwoFactor(page, authUser.password, baseURL!);
	await openTwoFactorChallenge(page, authUser);
	const recovered = await page.request.post("/api/auth/two-factor/verify-backup-code", {
		headers: { Origin: baseURL! },
		data: { code: backupCodes[0], trustDevice: false },
	});

	expect(recovered.ok(), await recovered.text()).toBe(true);
	await gotoAndWaitForAppReady(page, "/volumes");
	await expectSignedIn(page, authUser.username);

	await openTwoFactorChallenge(page, authUser);
	const reused = await page.request.post("/api/auth/two-factor/verify-backup-code", {
		headers: { Origin: baseURL! },
		data: { code: backupCodes[0], trustDevice: false },
	});

	expect(reused.ok()).toBe(false);
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
	const unused = await page.request.post("/api/auth/two-factor/verify-backup-code", {
		headers: { Origin: baseURL! },
		data: { code: backupCodes[1], trustDevice: false },
	});

	expect(unused.ok(), await unused.text()).toBe(true);
	await gotoAndWaitForAppReady(page, "/volumes");
	await expectSignedIn(page, authUser.username);
});

test("trusting a device skips the next challenge, while clearing cookies requires 2FA again", async ({
	page,
	authUser,
	baseURL,
}) => {
	const { secret } = await enableTwoFactor(page, authUser.password, baseURL!);
	await openTwoFactorChallenge(page, authUser);
	await page.getByRole("checkbox", { name: "Trust this device for 30 days" }).check();
	await fillOtp(page, await generateTotp(secret));
	await expectSignedIn(page, authUser.username);

	await page.getByRole("button", { name: "Logout", exact: true }).click();
	await expect(page).toHaveURL(/\/login$/);
	await signInWithPassword(page, authUser);
	await expectSignedIn(page, authUser.username);
	await openTwoFactorChallenge(page, authUser);
});

test("disabling 2FA requires the correct password and restores password-only login", async ({
	page,
	authUser,
	baseURL,
}) => {
	await enableTwoFactor(page, authUser.password, baseURL!);
	await gotoAndWaitForAppReady(page, "/settings");
	await page.getByRole("button", { name: "Disable 2FA", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Disable Two-Factor Authentication", exact: true });
	await dialog.getByRole("textbox", { name: "Your password" }).fill("incorrect-password");
	await dialog.getByRole("button", { name: "Disable 2FA", exact: true }).click();
	await expect(page.getByText("Failed to disable 2FA", { exact: true })).toBeVisible();

	await dialog.getByRole("textbox", { name: "Your password" }).fill(authUser.password);
	await dialog.getByRole("button", { name: "Disable 2FA", exact: true }).click();
	await expect(page.getByText(/Status:\s*Disabled/)).toBeVisible();
	await page.context().clearCookies();
	await signInWithPassword(page, authUser);
	await expectSignedIn(page, authUser.username);
});

test("regenerating recovery codes invalidates the old set", async ({ page, authUser, baseURL }) => {
	const { backupCodes } = await enableTwoFactor(page, authUser.password, baseURL!);
	await gotoAndWaitForAppReady(page, "/settings");
	await page.getByRole("button", { name: "Backup Codes", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Backup Codes", exact: true });
	await dialog.getByRole("textbox", { name: "Your password" }).fill(authUser.password);
	const generated = page.waitForResponse((response) => response.url().endsWith("/two-factor/generate-backup-codes"));
	await dialog.getByRole("button", { name: "Generate new codes", exact: true }).click();
	const response = await generated;
	expect(response.ok()).toBe(true);
	const replacement = (await response.json()) as { backupCodes: string[] };
	expect(replacement.backupCodes).toHaveLength(5);
	await page.keyboard.press("Escape");
	await expect(dialog).not.toBeVisible();

	await openTwoFactorChallenge(page, authUser);
	const rejected = await page.request.post("/api/auth/two-factor/verify-backup-code", {
		headers: { Origin: baseURL! },
		data: { code: backupCodes[0], trustDevice: false },
	});

	expect(rejected.ok()).toBe(false);
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
	const accepted = await page.request.post("/api/auth/two-factor/verify-backup-code", {
		headers: { Origin: baseURL! },
		data: { code: replacement.backupCodes[0], trustDevice: false },
	});

	expect(accepted.ok(), await accepted.text()).toBe(true);
	await gotoAndWaitForAppReady(page, "/volumes");
	await expectSignedIn(page, authUser.username);
});
