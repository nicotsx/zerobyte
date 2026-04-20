import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { type Page, type TestInfo } from "@playwright/test";
import { expect, test } from "./test";
import { gotoAndWaitForAppReady } from "./helpers/page";

const testDataPath = path.join(process.cwd(), "playwright", "temp");

type RepositorySummary = {
	name: string;
	shortId: string;
};

function getRunId(testInfo: TestInfo) {
	return `${testInfo.parallelIndex}-${testInfo.retry}-${randomUUID().slice(0, 8)}`;
}

function getWorkerTestDataPath() {
	fs.mkdirSync(testDataPath, { recursive: true });
	return testDataPath;
}

async function listRepositories(page: Page) {
	const response = await page.request.get("/api/v1/repositories");
	expect(response.ok()).toBe(true);
	return (await response.json()) as RepositorySummary[];
}

async function getRepositoryShortId(page: Page, name: string) {
	const repositories = await listRepositories(page);
	const repository = repositories.find((entry) => entry.name === name);
	expect(repository).toBeDefined();
	return repository!.shortId;
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

	const backupPageUrl = page.url();
	const primaryRepoShortId = await getRepositoryShortId(page, primaryRepoName);
	const mirrorRepoShortId = await getRepositoryShortId(page, mirrorRepoName);

	// Run a backup to create a snapshot and wait for it to persist.
	await page.getByRole("button", { name: "Backup now" }).click();
	await gotoAndWaitForAppReady(page, `/repositories/${primaryRepoShortId}`);
	await page.getByRole("tab", { name: "Snapshots" }).click();
	await expect(page.getByText("Backup snapshots stored in this repository.")).toBeVisible();
	await expect(async () => {
		await page.getByRole("button", { name: "Refresh" }).click();
		await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(1);
	}).toPass({ timeout: 30000 });
	await gotoAndWaitForAppReady(page, backupPageUrl);

	// Add mirror repository
	await page.getByRole("button", { name: "Add mirror" }).click();
	const mirrorSelect = page.getByRole("combobox").filter({ hasText: "Select a repository to mirror to..." });
	await mirrorSelect.click();
	await page.getByRole("option", { name: mirrorRepoName }).click();
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);

	// Click sync button on the mirror row (first icon button in the actions cell)
	const mirrorRow = page.getByRole("row").filter({ hasText: mirrorRepoName });
	await expect(mirrorRow).toBeVisible();
	await mirrorRow.getByRole("button").first().click();

	// Verify the sync dialog shows missing snapshots
	const syncDialog = page.getByRole("dialog");
	await expect(syncDialog.getByRole("heading", { name: "Sync snapshots" })).toBeVisible();
	await expect(syncDialog.getByText(/1 of 1 snapshots are missing/)).toBeVisible({ timeout: 15000 });

	// Select the missing snapshots explicitly before syncing.
	await expect(syncDialog.getByRole("button", { name: "Sync 0 snapshots" })).toBeDisabled();
	await syncDialog.getByRole("checkbox").first().click();
	const syncButton = syncDialog.getByRole("button", { name: "Sync 1 snapshots" });
	await expect(syncButton).toBeEnabled();

	// Click sync button and wait for the mirror repository to contain the snapshot.
	await syncButton.click();
	await gotoAndWaitForAppReady(page, `/repositories/${mirrorRepoShortId}`);
	await page.getByRole("tab", { name: "Snapshots" }).click();
	await expect(page.getByText("Backup snapshots stored in this repository.")).toBeVisible();
	await expect(async () => {
		await page.getByRole("button", { name: "Refresh" }).click();
		await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(1);
	}).toPass({ timeout: 30000 });
	await gotoAndWaitForAppReady(page, backupPageUrl);

	// Open sync dialog again and verify all snapshots are synced
	await mirrorRow.getByRole("button").first().click();
	await expect(syncDialog.getByRole("heading", { name: "Sync snapshots" })).toBeVisible();
	await expect(syncDialog.getByText(/All 1 snapshots are already synced/)).toBeVisible({ timeout: 15000 });
	await syncDialog.getByRole("button", { name: "Cancel" }).click();

	// Verify the synced snapshot remains visible in the mirror repository UI.
	await gotoAndWaitForAppReady(page, `/repositories/${mirrorRepoShortId}`);
	await page.getByRole("tab", { name: "Snapshots" }).click();
	await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(1);
});
