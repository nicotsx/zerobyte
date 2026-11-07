import { expect } from "@playwright/test";
import { expectSignedIn, prepareAuthTests } from "./helpers/auth";
import { gotoAndWaitForAppReady } from "./helpers/page";
import { addPasskey, openPasskeyLogin, test } from "./helpers/passkeys";

test.describe.configure({ mode: "default" });
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(prepareAuthTests);

test("registers a resident passkey and signs in with a persistent session", async ({
	page,
	authenticator,
	authUser,
}) => {
	await addPasskey(page, "Test device");
	const [registered] = await authenticator.credentials();
	expect(registered.isResidentCredential).toBe(true);

	await openPasskeyLogin(page);
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await expectSignedIn(page, authUser.username);
	const [used] = await authenticator.credentials();
	expect(used.signCount).toBeGreaterThan(registered.signCount);
});

test("a renamed passkey still signs in to the same account", async ({ page, authenticator, authUser }) => {
	await addPasskey(page, "Original device");
	await page.getByRole("button", { name: "Rename passkey Original device", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Rename passkey" });
	await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Renamed device");
	await dialog.getByRole("button", { name: "Save", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole("button", { name: "Rename passkey Renamed device", exact: true })).toBeVisible();
	expect(await authenticator.credentials()).toHaveLength(1);

	await openPasskeyLogin(page);
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await expectSignedIn(page, authUser.username);
});

test("rejects a deleted passkey and allows password fallback", async ({ page, authenticator, authUser }) => {
	await addPasskey(page, "Revoked device");
	const [revoked] = await authenticator.credentials();
	await authenticator.removeCredential(revoked.credentialId);
	await addPasskey(page, "Backup device");
	const backup = (await authenticator.credentials()).find(
		(credential) => credential.credentialId !== revoked.credentialId,
	)!;

	await page.getByRole("button", { name: "Delete passkey Revoked device", exact: true }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page.getByRole("button", { name: "Delete passkey Revoked device", exact: true })).not.toBeVisible();
	await authenticator.removeCredential(backup.credentialId);
	await authenticator.addCredential(revoked);

	await openPasskeyLogin(page);
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await expect(page.getByText(/Passkey sign-in failed\./)).toBeVisible();
	expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();

	await page.getByRole("textbox", { name: "Username" }).fill(authUser.username);
	await page.getByRole("textbox", { name: "Password", exact: true }).fill(authUser.password);
	await page.getByRole("button", { name: "Login", exact: true }).click();
	await expectSignedIn(page, authUser.username);
});

for (const scenario of [
	{ name: "missing user verification", override: { isBadUV: true } },
	{ name: "an invalid signature", override: { isBogusSignature: true } },
]) {
	test(`rejects ${scenario.name} without creating a session, then accepts a valid assertion`, async ({
		page,
		authenticator,
		authUser,
	}) => {
		await addPasskey(page, "Verified device");
		await authenticator.overrideResponse(scenario.override);
		await openPasskeyLogin(page);
		await page.getByRole("button", { name: "Sign in with passkey" }).click();
		await expect(page.getByText(/Passkey sign-in failed\./)).toBeVisible();
		expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();

		await authenticator.overrideResponse({});
		await page.getByRole("button", { name: "Sign in with passkey" }).click();
		await expectSignedIn(page, authUser.username);
	});
}

test.describe("conditional mediation", () => {
	test.use({ conditionalMediation: true });

	test("a resident passkey signs in through conditional autofill", async ({ page, authenticator, authUser }) => {
		await addPasskey(page, "Autofill device");
		expect(await authenticator.credentials()).toHaveLength(1);

		await page.context().clearCookies();
		await gotoAndWaitForAppReady(page, "/login");
		await expectSignedIn(page, authUser.username);
	});
});
