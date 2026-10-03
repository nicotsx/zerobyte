import { expect, test } from "@playwright/test";
import { gotoAndWaitForAppReady, waitForAppReady } from "./helpers/page";

const appOrigin = "https://zerobyte.example.com:5558";
const providerId = "test-oidc-proxy";
const issuer = "https://tinyauth.example.com:5557";

test("SSO signs in with the public HTTPS callback behind an HTTP upstream", async ({ page, browser }) => {
	await gotoAndWaitForAppReady(page, "/onboarding");

	await page.getByRole("textbox", { name: "Email" }).fill("proxy-admin@example.com");
	await page.getByRole("textbox", { name: "Username" }).fill("proxy-admin");
	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");
	await page.getByRole("button", { name: "Create admin user" }).click();
	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("password");
	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();
	await downloadPromise;
	await expect(page).toHaveURL(`${appOrigin}/volumes`);

	await gotoAndWaitForAppReady(page, "/settings/sso/new");
	await page.getByRole("textbox", { name: "Provider ID" }).fill(providerId);
	await page.getByRole("textbox", { name: "Organization Domain" }).fill("example.com");
	await page.getByRole("textbox", { name: "Issuer URL" }).fill(issuer);
	await page.getByRole("textbox", { name: "Discovery Endpoint" }).fill(`${issuer}/.well-known/openid-configuration`);
	await page.getByRole("textbox", { name: "Client ID" }).fill("zerobyte-test");
	await page.getByRole("textbox", { name: "Client Secret" }).fill("test-secret-12345");
	await page.getByRole("button", { name: "Register Provider" }).click();
	await expect(page.getByText("SSO provider registered successfully")).toBeVisible();

	const invitation = await page.evaluate(async () => {
		const response = await fetch("/api/auth/organization/invite-member", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "user@example.com", role: "member" }),
		});

		return { ok: response.ok, body: await response.text() };
	});
	expect(invitation.ok, invitation.body).toBe(true);

	const signedOutContext = await browser.newContext({
		baseURL: appOrigin,
		ignoreHTTPSErrors: true,
		storageState: { cookies: [], origins: [] },
	});

	try {
		const ssoPage = await signedOutContext.newPage();
		await gotoAndWaitForAppReady(ssoPage, "/login");
		await expect(ssoPage).toHaveURL(`${appOrigin}/login`);

		const signIn = await ssoPage.evaluate(async (id) => {
			const response = await fetch("/api/auth/sign-in/sso", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ providerId: id, callbackURL: "/volumes" }),
			});

			return {
				status: response.status,
				body: (await response.json()) as { url?: string },
			};
		}, providerId);

		expect(signIn.status).toBe(200);
		if (!signIn.body.url) {
			throw new Error("SSO sign-in did not return an authorization URL");
		}

		const authorizationUrl = new URL(signIn.body.url);
		expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
			`${appOrigin}/api/auth/sso/callback/${providerId}`,
		);

		await ssoPage.goto(authorizationUrl.toString());
		await ssoPage.locator('input[name="username"]').fill("user@example.com");
		await ssoPage.locator('input[name="password"]').fill("password");
		await ssoPage.locator('button[type="submit"]').click();

		const authorizeButton = ssoPage.getByRole("button", { name: /authorize|allow/i });
		await expect
			.poll(() => authorizeButton.isVisible().then((visible) => visible || ssoPage.url().startsWith(appOrigin)), {
				timeout: 30000,
			})
			.toBe(true);

		if (await authorizeButton.isVisible()) {
			await authorizeButton.click();
		}

		await expect(ssoPage).toHaveURL(`${appOrigin}/volumes`, { timeout: 30000 });
		await waitForAppReady(ssoPage);
	} finally {
		await signedOutContext.close();
	}
});
