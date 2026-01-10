import fs from "fs";
import { test, expect } from "@playwright/test";
import { resetDatabase } from "./helpers/db";
import { createTestAccount } from "./helpers/account";

// Run tests in serial mode to avoid conflicts during onboarding
test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
	await resetDatabase();
});

test("should redirect to onboarding", async ({ page }) => {
	await page.goto("/");

	await page.waitForURL(/onboarding/);

	await expect(page).toHaveTitle(/Zerobyte - Onboarding/);
});

test("user can register a new account", async ({ page }) => {
	await page.goto("/onboarding");

	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");

	await page.getByRole("textbox", { name: "Username" }).fill("test");

	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");

	await page.getByRole("button", { name: "Create admin user" }).click();

	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();
});

test("user can download recovery key", async ({ page }) => {
	await createTestAccount(page);

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("test");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();

	// Should not be able to download with invalid confirm password
	await expect(page.getByText("Invalid password")).toBeVisible();

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("password");

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();

	const download = await downloadPromise;

	expect(download.suggestedFilename()).toBe("restic.pass");
	await download.saveAs("./data/restic.pass");

	const fileContent = await fs.promises.readFile("./data/restic.pass", "utf8");

	expect(fileContent).toHaveLength(64);
});

test("can't create another admin user after initial setup", async ({ page }) => {
	await createTestAccount(page);

	await page.goto("/onboarding");

	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");

	await page.getByRole("textbox", { name: "Username" }).fill("test");

	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");

	await page.getByRole("button", { name: "Create admin user" }).click();

	await expect(page.getByText("Admin user already exists")).toBeVisible();
});
