import { request, type APIRequestContext, type Page } from "@playwright/test";
import { expect, test } from "./test";
import { db } from "./helpers/db";
import { gotoAndWaitForAppReady } from "./helpers/page";

const origin = `http://${process.env.SERVER_IP ?? "localhost"}:4096`;
const issuer = process.env.E2E_TINYAUTH_ORIGIN ?? "https://tinyauth.example.com:5557";
const providerId = "test-oidc-member-link";
const email = "explicitlink@example.com";
const otherEmail = "otherlink@example.com";
const password = "password";

async function post<T = unknown>(api: APIRequestContext, url: string, data: Record<string, unknown>) {
	const response = await api.post(url, { data, headers: { Origin: origin } });
	expect(response.ok(), `${url}: ${await response.text()}`).toBe(true);

	return (await response.json()) as T;
}

async function signInAtProvider(page: Page, providerEmail: string) {
	await page.locator('input[name="username"]').fill(providerEmail);
	await page.locator('input[name="password"]').fill(password);
	await page.locator('button[type="submit"]').click();

	const authorize = page.getByRole("button", { name: /authorize|allow/i });
	const returnedToApp = () => new URL(page.url()).origin === origin;
	await expect.poll(async () => returnedToApp() || (await authorize.isVisible())).toBe(true);
	if (!returnedToApp()) await authorize.click();
}

async function signInWithSso(page: Page) {
	await gotoAndWaitForAppReady(page, "/login");
	await page.getByRole("button", { name: `Log in with ${providerId}` }).click();
	await page.waitForURL((url) => url.origin === issuer);
	await signInAtProvider(page, email);
}

test.use({ storageState: { cookies: [], origins: [] } });

async function setupExistingMembers(page: Page, otherPage: Page) {
	const instanceAdmin = await request.newContext({ baseURL: origin, storageState: "playwright/.auth/user.json" });
	const owner = await request.newContext({ baseURL: origin });
	try {
		await post(owner, "/api/auth/sign-up/email", {
			email: "sso-link-owner@example.com",
			username: "sso-link-owner",
			name: "SSO Link Owner",
			password,
		});
		let organizationId = "";
		for (const [memberPage, memberEmail, username] of [
			[page, email, "sso-link-member"],
			[otherPage, otherEmail, "sso-link-other"],
		] as const) {
			await post(instanceAdmin, "/api/auth/admin/create-user", {
				email: memberEmail,
				password,
				name: username,
				role: "user",
				data: { username, hasDownloadedResticPassword: true },
			});

			const invitation = await post<{ id: string; organizationId: string }>(
				owner,
				"/api/auth/organization/invite-member",
				{ email: memberEmail, role: "member" },
			);
			organizationId = invitation.organizationId;

			await post(memberPage.request, "/api/auth/sign-in/email", { email: memberEmail, password });
			await post(memberPage.request, "/api/auth/organization/accept-invitation", { invitationId: invitation.id });
			await post(memberPage.request, "/api/auth/organization/set-active", { organizationId });
		}

		await post(owner, "/api/auth/sso/register", {
			providerId,
			organizationId,
			issuer,
			domain: "example.com",
			oidcConfig: {
				clientId: "zerobyte-test",
				clientSecret: "test-secret-12345",
				discoveryEndpoint: `${issuer}/.well-known/openid-configuration`,
				scopes: ["openid", "email", "profile"],
			},
		});

		return organizationId;
	} finally {
		await Promise.all([instanceAdmin.dispose(), owner.dispose()]);
	}
}

async function linkSso(page: Page, providerEmail: string) {
	await gotoAndWaitForAppReady(page, "/settings?scope=personal");
	await page.getByRole("button", { name: "Link SSO" }).click();
	await page.waitForURL((url) => url.origin === issuer);
	await signInAtProvider(page, providerEmail);
}

async function getSessionId(page: Page) {
	const response = await page.request.get("/api/auth/get-session");
	expect(response.ok()).toBe(true);
	const { session } = (await response.json()) as { session: { id: string } };
	return session.id;
}

test("an existing member can link their own SSO identity from personal settings", async ({ browser, page }) => {
	const otherContext = await browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
	const otherPage = await otherContext.newPage();
	const organizationId = await setupExistingMembers(page, otherPage);

	await linkSso(otherPage, otherEmail);
	await expect(otherPage.getByText("Linked", { exact: true })).toBeVisible();
	await otherContext.close();

	const otherAccount = await db.query.account.findFirst({ where: { providerId } });
	expect(otherAccount).toBeDefined();

	const sessionId = await getSessionId(page);
	await linkSso(page, otherEmail);
	await expect(page.getByText(/SSO linking failed/)).toBeVisible();
	expect(await getSessionId(page)).toBe(sessionId);

	const currentAccount = await db.query.account.findFirst({ where: { providerId } });
	expect(currentAccount?.updatedAt).toEqual(otherAccount?.updatedAt);
	expect(currentAccount?.idToken === otherAccount?.idToken).toBe(true);

	await page.context().clearCookies();
	await signInWithSso(page);
	await expect(page.getByText(/SSO sign-in was blocked because this email already belongs/)).toBeVisible();

	await page.context().clearCookies();
	await post(page.request, "/api/auth/sign-in/email", { email, password });
	await post(page.request, "/api/auth/organization/set-active", { organizationId });

	const linkingSessionId = await getSessionId(page);
	await linkSso(page, email);
	await expect(page.getByText("Linked", { exact: true })).toBeVisible();
	expect(await getSessionId(page)).toBe(linkingSessionId);

	await page.context().clearCookies();
	await signInWithSso(page);
	await expect(page).toHaveURL(/\/volumes/);
});
