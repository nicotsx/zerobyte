import { expect, test } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

test.beforeAll(() => {
	const testDataPath = path.join(process.cwd(), "playwright", "temp");
	if (fs.existsSync(testDataPath)) {
		fs.rmSync(testDataPath, { recursive: true, force: true });
	}
});

test("can backup & restore a file", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveURL("/volumes");

	// 0. Create a test file in /test-data
	const testDataPath = path.join(process.cwd(), "playwright", "temp");
	if (!fs.existsSync(testDataPath)) {
		fs.mkdirSync(testDataPath);
	}
	const filePath = path.join(testDataPath, "test.json");
	fs.chmodSync(testDataPath, 0o777);
	fs.writeFileSync(filePath, JSON.stringify({ data: "test file" }));

	// 1. Create a local volume on /test-data
	await page.getByRole("button", { name: "Create Volume" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill("Test Volume");
	await page.getByRole("button", { name: "Change" }).click();
	await page.getByRole("button", { name: "test-data" }).click();
	await page.getByRole("button", { name: "Create Volume" }).click();
	await expect(page.getByText("Volume created successfully")).toBeVisible();

	// 2. Create a local repository on the default location
	await page.getByRole("link", { name: "Repositories" }).click();
	await page.getByRole("button", { name: "Create repository" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill("Test Repo");
	await page.getByRole("combobox", { name: "Backend" }).click();
	await page.getByRole("option", { name: "Local" }).click();
	await page.getByRole("button", { name: "Create repository" }).click();
	await expect(page.getByText("Repository created successfully")).toBeVisible();

	// 3. Create a backup schedule
	await page.getByRole("link", { name: "Backups" }).click();
	await page.getByRole("button", { name: "Create a backup job" }).click();
	await page.getByRole("combobox").filter({ hasText: "Choose a volume to backup" }).click();
	await page.getByRole("option", { name: "test-volume" }).click();
	await page.getByRole("textbox", { name: "Backup name" }).fill("Test Backup");
	await page.getByRole("combobox").filter({ hasText: "Select a repository" }).click();
	await page.getByRole("option", { name: "Test Repo" }).click();
	await page.getByRole("combobox").filter({ hasText: "Select frequency" }).click();
	await page.getByRole("option", { name: "Daily" }).click();
	await page.getByRole("textbox", { name: "Execution time" }).fill("00:00");
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText("Backup job created successfully")).toBeVisible();

	// 4. Runs that schedule once
	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	// 5. Modify the json file after the backup
	fs.writeFileSync(filePath, JSON.stringify({ data: "modified file" }));

	// 6. Restores the file from backup
	await page.getByRole("link", { name: "Restore" }).click();
	await expect(page).toHaveURL(/\/restore/);
	await page.getByRole("button", { name: "Restore All" }).click();
	await expect(page.getByText("Restore completed")).toBeVisible({ timeout: 30000 });

	// 7. Ensures that the file is back to its previous state
	const restoredContent = fs.readFileSync(filePath, "utf8");
	expect(JSON.parse(restoredContent)).toEqual({ data: "test file" });
});
