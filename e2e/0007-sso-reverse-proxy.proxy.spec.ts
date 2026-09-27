import { expect, test } from "@playwright/test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const appOrigin = "https://zerobyte.example.com:5558";
const providerId = "test-oidc-proxy";
const issuer = "https://tinyauth.example.com:5557";

test("SSO uses the public HTTPS callback behind an HTTP upstream", async ({ page }) => {
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

	const signIn = await page.evaluate(async (id) => {
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
	expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(`${appOrigin}/api/auth/sso/callback/${providerId}`);

	await page.goto(authorizationUrl.toString());
	await expect(page.locator('input[name="username"]')).toBeVisible();
});
