import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./test";
import { trackBrowserErrors } from "./helpers/browser-errors";
import { gotoAndWaitForAppReady, waitForAppReady } from "./helpers/page";

const dexOrigin = process.env.E2E_DEX_ORIGIN ?? "http://dex:5557";
const issuer = `${dexOrigin}/dex`;
const discoveryEndpoint = `${issuer}/.well-known/openid-configuration`;
const appBaseUrl = `http://${process.env.SERVER_IP ?? "localhost"}:4096`;

const providerIds = {
	uninvited: "test-oidc-uninvited",
	invited: "test-oidc-invited",
	autoLinkNoInvite: "test-oidc-register",
	autoLink: "test-oidc-autolink",
} as const;

const dexPassword = "password";
const uninvitedUserEmail = "admin@example.com";
const invitedUserEmail = "user@example.com";
const autoLinkUninvitedLocalEmail = "linkguard@example.com";
const autoLinkTargetEmail = "test@example.com";
const autoLinkTargetUsername = "sso-link-target";
const autoLinkUninvitedLocalUsername = "sso-link-guard";
const inviteOnlyMessage =
	"Access is invite-only. Ask an organization admin to send you an invitation before signing in with SSO.";
const accountLinkRequiredMessage =
	"SSO sign-in was blocked because this email already belongs to another user in this instance. Contact your administrator to resolve the account conflict.";

type OrgMembersResponse = {
	members: {
		id: string;
		user: {
			email: string;
		};
	}[];
};

type SsoSettingsResponse = {
	invitations: {
		email: string;
		status: string;
	}[];
};

type SsoSignInResponse = {
	url?: string;
};

async function openSsoSettings(page: Page) {
	await gotoAndWaitForAppReady(page, "/settings?tab=organization");
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

async function createLocalUser(page: Page, email: string, username: string) {
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
		throw new Error(`Failed to create local user ${email}: ${await response.text()}`);
	}
}

async function getOrgMemberIdByEmail(page: Page, email: string) {
	const response = await page.request.get("/api/v1/auth/org-members", {
		headers: {
			Origin: appBaseUrl,
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to get organization members: ${await response.text()}`);
	}

	const body = (await response.json()) as OrgMembersResponse;
	const member = body.members.find((entry) => entry.user.email.toLowerCase() === email.toLowerCase());

	return member?.id ?? null;
}

async function removeOrgMemberById(page: Page, memberId: string) {
	const response = await page.request.delete(`/api/v1/auth/org-members/${memberId}`, {
		headers: {
			Origin: appBaseUrl,
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to remove org member ${memberId}: ${await response.text()}`);
	}
}

async function getInvitationStatusByEmail(page: Page, email: string) {
	const response = await page.request.get("/api/v1/auth/sso-settings", {
		headers: {
			Origin: appBaseUrl,
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to read SSO settings: ${await response.text()}`);
	}

	const body = (await response.json()) as SsoSettingsResponse;
	const invitation = body.invitations.find((entry) => entry.email.toLowerCase() === email.toLowerCase());

	return invitation?.status ?? null;
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

async function startSsoLogin(page: Page, providerId: string) {
	const response = await page.request.post("/api/auth/sign-in/sso", {
		headers: {
			Origin: appBaseUrl,
		},
		data: {
			providerId,
			callbackURL: "/volumes",
			errorCallbackURL: "/api/v1/auth/login-error",
		},
	});

	if (!response.ok()) {
		throw new Error(`Failed to start SSO login for ${providerId}: ${await response.text()}`);
	}

	const body = (await response.json()) as SsoSignInResponse;

	if (!body.url) {
		throw new Error(`SSO login response missing redirect URL for ${providerId}`);
	}

	return body.url;
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
	const browserErrorTracker = trackBrowserErrors(context);
	const page = await context.newPage();

	try {
		const ssoUrl = await startSsoLogin(page, providerId);
		await page.goto(ssoUrl);

		const dexLoginInput = page.locator('input[name="login"]');
		const dexLoginIsVisible = await dexLoginInput.isVisible({ timeout: 5000 }).catch(() => false);

		if (dexLoginIsVisible) {
			await dexLoginInput.fill(dexLogin);
			await page.locator('input[name="password"]').fill(dexPassword);
			await page.locator('button[type="submit"]').click();
		}

		await assertions(page);
		browserErrorTracker.assertNoBrowserErrors();
	} finally {
		await context.close().catch(() => undefined);
	}
}

function isLoginPath(url: string): boolean {
	const pathname = new URL(url).pathname;
	return pathname === "/login" || pathname === "/login/error";
}

function isSsoCallbackPath(url: string): boolean {
	return new URL(url).pathname.startsWith("/api/auth/sso/callback/");
}

async function expectInviteOnlyLoginError(page: Page) {
	await expect
		.poll(
			() => {
				const url = page.url();
				return isLoginPath(url) || isSsoCallbackPath(url);
			},
			{ timeout: 30000 },
		)
		.toBe(true);

	if (isLoginPath(page.url())) {
		await waitForAppReady(page);
		await expect(page.getByText(inviteOnlyMessage)).toBeVisible();
		return;
	}

	await expect(page.getByText(/invite-only/i)).toBeVisible();
}

async function expectAccountLinkRequiredLoginError(page: Page) {
	await expect
		.poll(
			() => {
				const url = page.url();
				return isLoginPath(url) || isSsoCallbackPath(url);
			},
			{ timeout: 30000 },
		)
		.toBe(true);

	if (isLoginPath(page.url())) {
		await waitForAppReady(page);
		await expect(page.getByText(accountLinkRequiredMessage)).toBeVisible();
		return;
	}

	await expect(
		page.getByText(
			/(account not linked|unable to link account|already belongs to another user|outside this organization)/i,
		),
	).toBeVisible();
}

test("uninvited OIDC users are blocked", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.uninvited);

	await withOidcLoginAttempt(browser, providerIds.uninvited, uninvitedUserEmail, async (ssoPage) => {
		await expectInviteOnlyLoginError(ssoPage);
	});
});

test("invited OIDC users can sign in, retain access, and are blocked after removal", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.invited);
	await createPendingInvitation(page, invitedUserEmail);

	await withOidcLoginAttempt(browser, providerIds.invited, invitedUserEmail, async (ssoPage) => {
		await ssoPage.waitForURL(/\/volumes/, { timeout: 30000 });
		await waitForAppReady(ssoPage);
		await expect(ssoPage).toHaveURL(/\/volumes/);
	});

	await expect
		.poll(async () => {
			return getInvitationStatusByEmail(page, invitedUserEmail);
		})
		.toBe("accepted");

	await withOidcLoginAttempt(browser, providerIds.invited, invitedUserEmail, async (ssoPage) => {
		await ssoPage.waitForURL(/\/volumes/, { timeout: 30000 });
		await waitForAppReady(ssoPage);
		await expect(ssoPage).toHaveURL(/\/volumes/);
	});

	await expect
		.poll(async () => {
			return getOrgMemberIdByEmail(page, invitedUserEmail);
		})
		.not.toBeNull();

	const memberId = await getOrgMemberIdByEmail(page, invitedUserEmail);

	if (!memberId) {
		throw new Error(`Missing organization member for ${invitedUserEmail}`);
	}

	await removeOrgMemberById(page, memberId);

	await withOidcLoginAttempt(browser, providerIds.invited, invitedUserEmail, async (ssoPage) => {
		await expectInviteOnlyLoginError(ssoPage);
	});
});

test("auto-link policy enforces invitation and controls account linking", async ({ page, browser }) => {
	await registerOidcProvider(page, providerIds.autoLinkNoInvite);
	await createLocalUser(page, autoLinkUninvitedLocalEmail, autoLinkUninvitedLocalUsername);
	await setProviderAutoLinking(page, providerIds.autoLinkNoInvite, true);

	await withOidcLoginAttempt(browser, providerIds.autoLinkNoInvite, autoLinkUninvitedLocalEmail, async (ssoPage) => {
		await expectAccountLinkRequiredLoginError(ssoPage);
	});

	await registerOidcProvider(page, providerIds.autoLink);
	await createLocalUser(page, autoLinkTargetEmail, autoLinkTargetUsername);
	await createPendingInvitation(page, autoLinkTargetEmail);
	await setProviderAutoLinking(page, providerIds.autoLink, false);

	await withOidcLoginAttempt(browser, providerIds.autoLink, autoLinkTargetEmail, async (ssoPage) => {
		await expectAccountLinkRequiredLoginError(ssoPage);
	});

	await setProviderAutoLinking(page, providerIds.autoLink, true);

	await withOidcLoginAttempt(browser, providerIds.autoLink, autoLinkTargetEmail, async (ssoPage) => {
		await expectAccountLinkRequiredLoginError(ssoPage);
	});
});
