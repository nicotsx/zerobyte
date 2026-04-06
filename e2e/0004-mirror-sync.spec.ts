import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const testDataPath = path.join(process.cwd(), "playwright", "temp");

function getRunId(testInfo: TestInfo) {
	return `${testInfo.parallelIndex}-${testInfo.retry}-${randomUUID().slice(0, 8)}`;
}

function getWorkerTestDataPath() {
	fs.mkdirSync(testDataPath, { recursive: true });
	return testDataPath;
}

async function createRepository(page: Page, name: string) {
	await gotoAndWaitForAppReady(page, "/repositories");
	await page.getByRole("button", { name: "Create repository" }).click();
	await page.getByRole("textbox", { name: "Name" }).fill(name);
	await page.getByRole("combobox", { name: "Backend" }).click();
	await page.getByRole("option", { name: "Local" }).click();
	await page.getByRole("button", { name: "Create repository" }).click();
	await expect(page.getByText("Repository created successfully")).toBeVisible({ timeout: 30000 });
}

async function createVolume(page: Page, name: string) {
	await gotoAndWaitForAppReady(page, "/volumes");
	const volumeNameInput = page.getByRole("textbox", { name: "Name" });
	await expect(async () => {
		await page.getByRole("button", { name: "Create Volume" }).click();
		await expect(volumeNameInput).toBeVisible();
	}).toPass({ timeout: 10000 });
	await volumeNameInput.fill(name);
	await page.getByRole("button", { name: "test-data" }).click();
	await page.getByRole("button", { name: "Create Volume" }).click();
	await expect(page.getByText("Volume created successfully")).toBeVisible();
}

async function createBackupJob(page: Page, backupName: string, volumeName: string, repositoryName: string) {
	await gotoAndWaitForAppReady(page, "/backups");
	const createBackupButton = page.getByRole("button", { name: "Create a backup job" }).first();
	if (await createBackupButton.isVisible()) {
		await createBackupButton.click();
	} else {
		await page.getByRole("link", { name: "Create a backup job" }).first().click();
	}
	const volumeSelect = page.getByRole("combobox").filter({ hasText: "Choose a volume to backup" });
	const volumeOption = page.getByRole("option", { name: volumeName });
	await expect(async () => {
		await volumeSelect.click();
		await expect(volumeOption).toBeVisible();
	}).toPass({ timeout: 10000 });
	await volumeOption.click();
	await page.getByRole("textbox", { name: "Backup name" }).fill(backupName);
	await page.getByRole("combobox").filter({ hasText: "Select a repository" }).click();
	await page.getByRole("option", { name: repositoryName }).click();
	await page.getByRole("combobox").filter({ hasText: "Select frequency" }).click();
	await page.getByRole("option", { name: "Daily" }).click();
	await page.getByRole("textbox", { name: "Execution time" }).fill("00:00");
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText("Backup job created successfully")).toBeVisible();
}

test("can sync missing snapshots to a mirror repository", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const volumeName = `Volume-${runId}`;
	const primaryRepoName = `Primary-${runId}`;
	const mirrorRepoName = `Mirror-${runId}`;
	const backupName = `Backup-${runId}`;

	const workerTestDataPath = getWorkerTestDataPath();
	const runPath = path.join(workerTestDataPath, runId);
	fs.mkdirSync(runPath, { recursive: true });
	fs.writeFileSync(path.join(runPath, "test.json"), JSON.stringify({ data: "mirror sync test" }));

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	// Create volume, two repositories, and a backup job
	await createVolume(page, volumeName);
	await createRepository(page, primaryRepoName);
	await createRepository(page, mirrorRepoName);
	await createBackupJob(page, backupName, volumeName, primaryRepoName);

	// Run a backup to create a snapshot
	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText(/Success|Warning/).first()).toBeVisible({ timeout: 30000 });

	// Add mirror repository
	await page.getByRole("button", { name: "Add mirror" }).click();
	const mirrorSelect = page.getByRole("combobox").filter({ hasText: "Select a repository to mirror to..." });
	await mirrorSelect.click();
	await page.getByRole("option", { name: mirrorRepoName }).click();
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByText("Mirror settings saved successfully")).toBeVisible();

	// Click sync button on the mirror row (first icon button in the actions cell)
	const mirrorRow = page.getByRole("row").filter({ hasText: mirrorRepoName });
	await mirrorRow.getByRole("button").first().click();

	// Verify the sync dialog shows missing snapshots
	await expect(page.getByRole("heading", { name: "Sync snapshots" })).toBeVisible();
	await expect(page.getByText(/1 of 1 snapshots are missing/)).toBeVisible({ timeout: 15000 });

	// Verify there is a checkbox and a snapshot row
	const snapshotCheckbox = page.getByRole("dialog").getByRole("checkbox").first();
	await expect(snapshotCheckbox).toBeChecked();

	// Click sync button
	await page.getByRole("button", { name: "Sync 1 snapshots" }).click();
	await expect(page.getByText("Full sync started")).toBeVisible();

	// Wait for sync to complete
	await expect(page.getByText("Syncing...")).toBeVisible({ timeout: 10000 });
	await expect(page.getByText("Syncing...")).not.toBeVisible({ timeout: 30000 });

	// Open sync dialog again and verify all snapshots are synced
	await mirrorRow.getByRole("button").first().click();
	await expect(page.getByRole("heading", { name: "Sync snapshots" })).toBeVisible();
	await expect(page.getByText(/All 1 snapshots are already synced/)).toBeVisible({ timeout: 15000 });
	await page.getByRole("button", { name: "Cancel" }).click();

	// Verify snapshot appears in the mirror repository's snapshots tab
	const response = await page.request.get("/api/v1/repositories");
	expect(response.ok()).toBe(true);
	const repositories = (await response.json()) as Array<{ name: string; shortId: string }>;
	const mirrorRepo = repositories.find((r) => r.name === mirrorRepoName);
	expect(mirrorRepo).toBeDefined();

	await gotoAndWaitForAppReady(page, `/repositories/${mirrorRepo!.shortId}`);
	await page.getByRole("tab", { name: "Snapshots" }).click();
	await expect(page.getByText("Backup snapshots stored in this repository.")).toBeVisible();
	await page.getByRole("button", { name: "Refresh" }).click();
	await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(1, { timeout: 15000 });
});
