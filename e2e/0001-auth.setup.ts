import fs from "fs";
import { test, expect } from "./test";
import { db, resetDatabase } from "./helpers/db";
import path from "node:path";
import { REGISTRATION_ENABLED_KEY } from "~/server/core/constants";
import { appMetadataTable } from "~/server/db/schema";
import { gotoAndWaitForAppReady } from "./helpers/page";

const authFile = path.join(process.cwd(), "./playwright/.auth/user.json");
const enableRegistrations = async () => {
	const now = Date.now();

	await db
		.insert(appMetadataTable)
		.values({
			key: REGISTRATION_ENABLED_KEY,
			value: JSON.stringify(true),
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: appMetadataTable.key,
			set: {
				value: JSON.stringify(true),
				updatedAt: now,
			},
		});
};

// Run tests in serial mode to avoid conflicts during onboarding
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
	await resetDatabase();
});

test("should redirect to onboarding", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/onboarding");

	await expect(page).toHaveTitle(/Zerobyte - Onboarding/);
});

test("user can register a new account", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/onboarding");

	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");

	await page.getByRole("textbox", { name: "Username" }).fill("test");

	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");

	await page.getByRole("button", { name: "Create admin user" }).click();

	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();
});

test("user can download recovery key", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/login");

	await page.getByRole("textbox", { name: "Username" }).fill("test");
	await page.getByRole("textbox", { name: "Password" }).fill("password");
	await page.getByRole("button", { name: "Login" }).click();

	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("test");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();

	// Should not be able to download with invalid confirm password
	await expect(page.getByText("Invalid password")).toBeVisible();

	await page.getByRole("textbox", { name: "Confirm Your Password" }).fill("password");

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download Recovery Key" }).click();

	const download = await downloadPromise;

	expect(download.suggestedFilename()).toBe("restic.pass");
	await download.saveAs("./playwright/restic.pass");

	const fileContent = await fs.promises.readFile("./playwright/restic.pass", "utf8");

	expect(fileContent).toHaveLength(64);
});

test("can't create another admin user after initial setup", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/onboarding");

	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");

	await page.getByRole("textbox", { name: "Username" }).fill("test");

	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");

	await page.getByRole("button", { name: "Create admin user" }).click();

	await expect(page.getByText("Failed to create admin user")).toBeVisible();
});

test("can login after initial setup", async ({ page }) => {
	await gotoAndWaitForAppReady(page, "/login");

	await page.getByRole("textbox", { name: "Username" }).fill("test");
	await page.getByRole("textbox", { name: "Password" }).fill("password");
	await page.getByRole("button", { name: "Login" }).click();

	await expect(page).toHaveURL("/volumes");
	await expect(page.getByRole("heading", { name: "No sources" })).toBeVisible();

	await enableRegistrations();

	await page.context().storageState({ path: authFile });
});
