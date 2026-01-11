import { expect, type Page } from "@playwright/test";
import { db } from "./db";

export const createTestAccount = async (page: Page) => {
	const existingUsers = await db.query.usersTable.findFirst();

	if (existingUsers) {
		return;
	}

	await page.goto("/onboarding");

	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill("test@test.com");

	await page.getByRole("textbox", { name: "Username" }).fill("test");

	await page.getByRole("textbox", { name: "Password", exact: true }).fill("password");
	await page.getByRole("textbox", { name: "Confirm Password" }).fill("password");

	await page.getByRole("button", { name: "Create admin user" }).click();

	await expect(page.getByText("Download Your Recovery Key")).toBeVisible();
};
