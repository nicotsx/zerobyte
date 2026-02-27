import { expect, test, type Browser, type Page } from "@playwright/test";
import { gotoAndWaitForAppReady, waitForAppReady } from "./helpers/page";

const dexOrigin = process.env.E2E_DEX_ORIGIN ?? "http://dex:5557";
const issuer = `${dexOrigin}/dex`;
const discoveryEndpoint = `${issuer}/.well-known/openid-configuration`;
const appBaseUrl = `http://${process.env.SERVER_IP ?? "localhost"}:4096`;

const providerIds = {
	register: "test-oidc-register",
	uninvited: "test-oidc-uninvited",
	invited: "test-oidc-invited",
	autoLink: "test-oidc",
} as const;

const dexPassword = "password";
const uninvitedUserEmail = "admin@example.com";
const invitedUserEmail = "user@example.com";
const autoLinkTargetEmail = "test@example.com";
const autoLinkTargetUsername = "sso-link-target";
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";

async function openSsoSettings(page: Page) {
	await gotoAndWaitForAppReady(page, "/settings?tab=users");
	await expect(page.getByText("Single Sign-On")).toBeVisible();
}

async function registerOidcProvider(page: Page, providerId: string) {
	await gotoAndWaitForAppReady(page, "/settings/sso/new");

	await page.getByRole("textbox", { name: "Provider ID" }).fill(providerId);
	await page.getByRole("textbox", { name: "Organization Domain" }).fill("example.com");
	await page.getByRole("textbox", { name: "Issuer URL" }).fill(issuer);
	await page.getByRole("textbox", { name: "Discovery Endpoint" }).fill(discoveryEndpoint);
	await page.getByRole("textbox", { name: "Client ID" }).fill("zerobyte-test");
	await page.getByRole("textbox", { name: "Client Secret" }).fill("test-secret-12345");
	await page.getByRole("button", { name: "Register Provider" }).click();

	await expect(page.getByText("SSO provider registered successfully")).toBeVisible();
	await expect(page.getByRole("cell", { name: providerId, exact: true })).toBeVisible();
}

async function createPendingInvitation(page: Page, email: string) {
	const response = await page.request.post("/api/auth/organization/invite-member", {
		headers: {
			Origin: appBaseUrl,
		},
		data: {
			email,
			role: "member",
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to invite ${email}: ${await response.text()}`);
	}
}

async function createAutoLinkTargetUser(page: Page, email: string, username: string) {
	const response = await page.request.post("/api/auth/admin/create-user", {
		headers: {
			Origin: appBaseUrl,
		},
		data: {
			email,
			password: dexPassword,
			name: "SSO Link Target",
			role: "user",
			data: {
				username,
				hasDownloadedResticPassword: true,
			},
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to create auto-link target user: ${await response.text()}`);
	}
}

async function setProviderAutoLinking(page: Page, providerId: string, enabled: boolean) {
	await openSsoSettings(page);
	const providerRow = page
		.getByRole("row")
		.filter({ has: page.getByRole("cell", { name: providerId, exact: true }) })
		.first();
	const autoLinkSwitch = providerRow.getByRole("switch");
	const expectedState = enabled ? "true" : "false";
	const currentState = await autoLinkSwitch.getAttribute("aria-checked");
	const expectedToast = enabled ? "Automatic account linking enabled" : "Automatic account linking disabled";

	if (currentState !== expectedState) {
		await autoLinkSwitch.click();
		await expect(page.getByText(expectedToast)).toBeVisible();
	}

	await expect(autoLinkSwitch).toHaveAttribute("aria-checked", expectedState);
}

async function withOidcLoginAttempt(
	browser: Browser,
	providerId: string,
	dexLogin: string,
	assertions: (page: Page) => Promise<void>,
) {
	const context = await browser.newContext({
		storageState: {
			cookies: [],
			origins: [],
		},
	});
	const page = await context.newPage();

	try {
		await gotoAndWaitForAppReady(page, `${appBaseUrl}/login`);
		await page.getByRole("button", { name: `Log in with ${providerId}`, exact: true }).click();
		await page.waitForURL(/\/dex\/auth/, { timeout: 60000 });

		await page.locator('input[name="login"]').fill(dexLogin);
		await page.locator('input[name="password"]').fill(dexPassword);
		await page.locator('button[type="submit"]').click();

		await assertions(page);
	} finally {
		await context.close().catch(() => undefined);
	}
}

test("admin can register an OIDC provider", async ({ page }) => {
	await registerOidcProvider(page, providerIds.register);
});

test("uninvited OIDC users are blocked", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.uninvited);

	await withOidcLoginAttempt(browser, providerIds.uninvited, uninvitedUserEmail, async (ssoPage) => {
		await ssoPage.waitForURL(/\/login(\/error)?/, { timeout: 60000 });
		await waitForAppReady(ssoPage);
		await expect(ssoPage.getByText(inviteOnlyMessage)).toBeVisible();
	});
});

test("invited OIDC users can sign in", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.invited);
	await createPendingInvitation(page, invitedUserEmail);

	await withOidcLoginAttempt(browser, providerIds.invited, invitedUserEmail, async (ssoPage) => {
		await ssoPage.waitForURL(/\/volumes/, { timeout: 60000 });
		await waitForAppReady(ssoPage);
		await expect(ssoPage).toHaveURL(/\/volumes/);
	});
});

test("auto-link setting can be enabled for an OIDC provider", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.autoLink);
	await createAutoLinkTargetUser(page, autoLinkTargetEmail, autoLinkTargetUsername);
	await createPendingInvitation(page, autoLinkTargetEmail);

	await setProviderAutoLinking(page, providerIds.autoLink, true);

	await withOidcLoginAttempt(browser, providerIds.autoLink, autoLinkTargetEmail, async (ssoPage) => {
		await ssoPage.waitForURL(/\/volumes/, { timeout: 60000 });
		await waitForAppReady(ssoPage);
		await expect(ssoPage).toHaveURL(/\/volumes/);
	});
});
