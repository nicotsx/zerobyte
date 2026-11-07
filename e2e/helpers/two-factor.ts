import { expect, type Page } from "@playwright/test";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { signInWithPassword } from "./auth";

export async function generateTotp(secret: string) {
	return createOTP(base32.decode(secret)).totp();
}

export async function fillOtp(page: Page, code: string) {
	await page.locator('[data-slot="input-otp"]').fill(code);
}

export async function enableTwoFactor(page: Page, password: string, baseURL: string) {
	const response = await page.request.post("/api/auth/two-factor/enable", {
		headers: { Origin: baseURL },
		data: { password, method: "totp" },
	});

	expect(response.ok(), await response.text()).toBe(true);
	const { totpURI, backupCodes } = (await response.json()) as { totpURI: string; backupCodes: string[] };
	const secret = new URL(totpURI).searchParams.get("secret")!;
	const verified = await page.request.post("/api/auth/two-factor/verify-totp", {
		headers: { Origin: baseURL },
		data: { code: await generateTotp(secret) },
	});

	expect(verified.ok(), await verified.text()).toBe(true);
	return { secret, backupCodes };
}

export async function openTwoFactorChallenge(page: Page, user: { username: string; password: string }) {
	await page.context().clearCookies();
	await signInWithPassword(page, user);
	await expect(page.getByRole("heading", { name: "Two-Factor Authentication", exact: true })).toBeVisible();
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
}

export async function generateInvalidTotp(secret: string) {
	const otp = createOTP(base32.decode(secret));
	const counter = Math.floor(Date.now() / 30000);
	const validCodes = new Set(await Promise.all([-1, 0, 1].map((offset) => otp.hotp(counter + offset))));
	let candidate = "000000";
	while (validCodes.has(candidate)) candidate = String(Number(candidate) + 1).padStart(6, "0");

	return candidate;
}
