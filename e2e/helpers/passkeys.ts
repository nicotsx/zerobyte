import { expect, type Page } from "@playwright/test";
import { test as authTest } from "./auth";
import { gotoAndWaitForAppReady } from "./page";

async function createVirtualAuthenticator(page: Page, conditionalMediation: boolean) {
	if (!conditionalMediation) {
		// Explicit-button scenarios must not compete with the login page's autofill ceremony.
		await page.addInitScript(() => {
			PublicKeyCredential.isConditionalMediationAvailable = async () => false;
		});
	}

	const session = await page.context().newCDPSession(page);
	await session.send("WebAuthn.enable", { enableUI: false });
	const { authenticatorId } = await session.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});

	const credentials = async () => (await session.send("WebAuthn.getCredentials", { authenticatorId })).credentials;

	return {
		credentials,
		addCredential: (credential: Awaited<ReturnType<typeof credentials>>[number]) =>
			session.send("WebAuthn.addCredential", { authenticatorId, credential }),
		removeCredential: (credentialId: string) =>
			session.send("WebAuthn.removeCredential", { authenticatorId, credentialId }),
		overrideResponse: (options: { isBadUV?: boolean; isBogusSignature?: boolean }) =>
			session.send("WebAuthn.setResponseOverrideBits", { authenticatorId, ...options }),
		close: async () => {
			await session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
			await session.detach();
		},
	};
}

type PasskeyFixtures = {
	conditionalMediation: boolean;
	authenticator: Awaited<ReturnType<typeof createVirtualAuthenticator>>;
};

export const test = authTest.extend<PasskeyFixtures>({
	conditionalMediation: [false, { option: true }],
	authenticator: async ({ page, browserName, conditionalMediation }, use) => {
		authTest.skip(browserName !== "chromium", "Virtual WebAuthn authenticators require Chromium CDP.");
		const authenticator = await createVirtualAuthenticator(page, conditionalMediation);

		try {
			await use(authenticator);
		} finally {
			await authenticator.close();
		}
	},
});

export async function addPasskey(page: Page, name: string) {
	await gotoAndWaitForAppReady(page, "/settings");
	await page.getByRole("button", { name: "Add passkey", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Add a passkey" });
	await dialog.getByRole("textbox", { name: "Name (optional)" }).fill(name);
	await dialog.getByRole("button", { name: "Add passkey", exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole("button", { name: `Rename passkey ${name}`, exact: true })).toBeVisible();
}

export async function openPasskeyLogin(page: Page) {
	await page.context().clearCookies();
	await gotoAndWaitForAppReady(page, "/login");
	await expect(page.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
}
