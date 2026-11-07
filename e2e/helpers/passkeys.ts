import { randomUUID } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { gotoAndWaitForAppReady } from "./page";

const password = "passkey-test-password";

async function createAccount(request: APIRequestContext, baseURL: string) {
	const username = `pw-${randomUUID().slice(0, 12)}`;
	const response = await request.post("/api/auth/sign-up/email", {
		headers: { Origin: baseURL },
		data: { name: username, username, email: `${username}@example.com`, password },
	});

	expect(response.ok(), await response.text()).toBe(true);
	return { username, password };
}

export async function enablePasskeyTestRegistrations(request: APIRequestContext, baseURL: string) {
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
	passkeyUser: { username: string; password: string };
};

export const test = base.extend<PasskeyFixtures>({
	conditionalMediation: [false, { option: true }],
	authenticator: async ({ page, browserName, conditionalMediation }, use) => {
		base.skip(browserName !== "chromium", "Virtual WebAuthn authenticators require Chromium CDP.");
		const authenticator = await createVirtualAuthenticator(page, conditionalMediation);

		try {
			await use(authenticator);
		} finally {
			await authenticator.close();
		}
	},
	passkeyUser: async ({ page, baseURL }, use) => {
		if (!baseURL) throw new Error("Passkey tests require a baseURL.");
		const user = await createAccount(page.request, baseURL);
		const response = await page.request.post("/api/v1/system/restic-password", {
			headers: { Origin: baseURL },
			data: { password },
		});

		expect(response.ok(), await response.text()).toBe(true);
		await use(user);
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

export async function expectSignedIn(page: Page, username: string) {
	await expect(page).toHaveURL(/\/volumes$/);
	await page.reload();
	const response = await page.request.get("/api/auth/get-session");

	expect(response.ok()).toBe(true);
	expect(await response.json()).toMatchObject({ user: { username } });
	await expect(page.getByRole("button", { name: "Create Source" })).toBeVisible();
}
