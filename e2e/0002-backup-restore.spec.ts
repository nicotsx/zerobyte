import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const testDataPath = path.join(process.cwd(), "playwright", "temp");

type ScenarioNames = {
	volumeName: string;
	repositoryName: string;
	backupName: string;
};

function getRunId(testInfo: TestInfo) {
	return `${testInfo.parallelIndex}-${testInfo.retry}-${randomUUID().slice(0, 8)}`;
}

function getScenarioNames(runId: string): ScenarioNames {
	return {
		volumeName: `Volume-${runId}`,
		repositoryName: `Repo-${runId}`,
		backupName: `Backup-${runId}`,
	};
}

function prepareTestFile(runId: string): string {
	const runPath = path.join(testDataPath, runId);
	fs.mkdirSync(runPath, { recursive: true });

	const filePath = path.join(runPath, "test.json");
	fs.writeFileSync(filePath, JSON.stringify({ data: "test file" }));

	return filePath;
}

async function createBackupScenario(page: Page, names: ScenarioNames) {
	await page.getByRole("button", { name: "Create Volume" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill(names.volumeName);
	await page.getByRole("button", { name: "test-data" }).click();
	await page.getByRole("button", { name: "Create Volume" }).click();
	await expect(page.getByText("Volume created successfully")).toBeVisible();

	await page.getByRole("link", { name: "Repositories" }).click();
	await page.getByRole("button", { name: "Create repository" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill(names.repositoryName);
	await page.getByRole("combobox", { name: "Backend" }).click();
	await page.getByRole("option", { name: "Local" }).click();
	await page.getByRole("button", { name: "Create repository" }).click();
	await expect(page.getByText("Repository created successfully")).toBeVisible({ timeout: 30000 });

	await page.getByRole("link", { name: "Backups" }).click();
	const createBackupButton = page.getByRole("button", { name: "Create a backup job" }).first();
	if (await createBackupButton.isVisible()) {
		await createBackupButton.click();
	} else {
		await page.getByRole("link", { name: "Create a backup job" }).first().click();
	}
	await page.getByRole("combobox").filter({ hasText: "Choose a volume to backup" }).click();
	await page.getByRole("option", { name: names.volumeName }).click();
	await page.getByRole("textbox", { name: "Backup name" }).fill(names.backupName);
	await page.getByRole("combobox").filter({ hasText: "Select a repository" }).click();
	await page.getByRole("option", { name: names.repositoryName }).click();
	await page.getByRole("combobox").filter({ hasText: "Select frequency" }).click();
	await page.getByRole("option", { name: "Daily" }).click();
	await page.getByRole("textbox", { name: "Execution time" }).fill("00:00");
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText("Backup job created successfully")).toBeVisible();
}

test("can backup & restore a file", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);
	const filePath = prepareTestFile(runId);

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names);

	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	fs.writeFileSync(filePath, JSON.stringify({ data: "modified file" }));

	await page
		.getByRole("button", { name: /\d+ B$/ })
		.first()
		.click();
	await page.getByRole("link", { name: "Restore" }).click();
	await expect(page).toHaveURL(/\/restore/);
	await page.getByRole("button", { name: "Restore All" }).click();
	await expect(page.getByText("Restore completed")).toBeVisible({ timeout: 30000 });

	const restoredContent = fs.readFileSync(filePath, "utf8");
	expect(JSON.parse(restoredContent)).toEqual({ data: "test file" });
});

test("deleting a volume cascades and removes its backup schedule", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names);

	await gotoAndWaitForAppReady(page, "/backups");
	await page.getByText(names.backupName, { exact: true }).first().click();

	const volumeLink = page.locator("main").getByRole("link", { name: names.volumeName, exact: true }).first();
	await expect(volumeLink).toBeVisible();
	await volumeLink.click();
	await expect(page).toHaveURL(/\/volumes\/[^/?#]+/);
	await expect(page.getByText("Volume Configuration", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();

	await expect(async () => {
		await page.getByRole("button", { name: "Delete" }).click();
		await expect(page.getByRole("heading", { name: "Delete volume?" })).toBeVisible();
	}).toPass({ timeout: 10000 });
	await expect(page.getByText("All backup schedules associated with this volume will also be removed.")).toBeVisible();
	await page.getByRole("button", { name: "Delete volume" }).click();
	await expect(page.getByText("Volume deleted successfully")).toBeVisible();

	await gotoAndWaitForAppReady(page, "/backups");
	await expect(page.getByText(names.backupName, { exact: true })).toHaveCount(0);
});
