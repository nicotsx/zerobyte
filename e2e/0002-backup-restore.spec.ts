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

type ScenarioOptions = {
	includePatterns?: string;
	excludePatterns?: string;
	excludeIfPresent?: string;
	selectedPaths?: string[];
};

type BackupJobOptions = ScenarioOptions & {
	backupName: string;
	volumeName: string;
	repositoryName: string;
};

type RepositoryListItem = {
	name: string;
	shortId: string;
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

function prepareTestFile(runId: string, fileName = "test.json"): string {
	const runPath = path.join(testDataPath, runId);
	fs.mkdirSync(runPath, { recursive: true });

	const filePath = path.join(runPath, fileName);
	fs.writeFileSync(filePath, JSON.stringify({ data: "test file" }));

	return filePath;
}

async function createBackupScenario(page: Page, names: ScenarioNames, options: ScenarioOptions = {}) {
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

	await createBackupJob(page, {
		backupName: names.backupName,
		volumeName: names.volumeName,
		repositoryName: names.repositoryName,
		...options,
	});
}

async function createBackupJob(page: Page, options: BackupJobOptions) {
	await gotoAndWaitForAppReady(page, "/backups");

	const createBackupButton = page.getByRole("button", { name: "Create a backup job" }).first();
	if (await createBackupButton.isVisible()) {
		await createBackupButton.click();
	} else {
		await page.getByRole("link", { name: "Create a backup job" }).first().click();
	}
	const volumeSelect = page.getByRole("combobox").filter({ hasText: "Choose a volume to backup" });
	const volumeOption = page.getByRole("option", { name: options.volumeName });
	await expect(async () => {
		await volumeSelect.click();
		await expect(volumeOption).toBeVisible();
	}).toPass({ timeout: 10000 });
	await volumeOption.click();
	await page.getByRole("textbox", { name: "Backup name" }).fill(options.backupName);
	await page.getByRole("combobox").filter({ hasText: "Select a repository" }).click();
	await page.getByRole("option", { name: options.repositoryName }).click();
	await page.getByRole("combobox").filter({ hasText: "Select frequency" }).click();
	await page.getByRole("option", { name: "Daily" }).click();
	await page.getByRole("textbox", { name: "Execution time" }).fill("00:00");
	if (options.includePatterns) {
		await page.getByLabel("Additional include patterns").fill(options.includePatterns);
	}
	if (options.selectedPaths) {
		for (const selectedPath of options.selectedPaths) {
			const escapedPath = path.posix.basename(selectedPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			await page
				.getByRole("button", { name: new RegExp(escapedPath) })
				.getByRole("checkbox")
				.click();
		}
	}
	if (options.excludePatterns) {
		await page.getByLabel("Exclusion patterns").fill(options.excludePatterns);
	}
	if (options.excludeIfPresent) {
		await page.getByLabel("Exclude if file present").fill(options.excludeIfPresent);
	}
	await page.getByRole("button", { name: "Create" }).click();
	await expect(page.getByText("Backup job created successfully")).toBeVisible();
}

async function openRepositorySnapshots(page: Page, repositoryName: string) {
	const response = await page.request.get("/api/v1/repositories");
	expect(response.ok()).toBe(true);

	const repositories = (await response.json()) as RepositoryListItem[];
	const repository = repositories.find((entry) => entry.name === repositoryName);

	expect(repository).toBeDefined();
	await gotoAndWaitForAppReady(page, `/repositories/${repository!.shortId}`);
	await page.getByRole("tab", { name: "Snapshots" }).click();
	await expect(page.getByText("Backup snapshots stored in this repository.")).toBeVisible();
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

test("can restore a single selected file to a custom location", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);
	const fileName = `single-file-${runId}.json`;
	const filePath = prepareTestFile(runId, fileName);
	const restoreTargetPath = path.join(testDataPath, fileName);
	const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

	fs.rmSync(restoreTargetPath, { force: true });

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

	await page.getByRole("button", { name: "Custom location" }).click();
	await page.getByRole("button", { name: "Change" }).click();
	await page.getByRole("button", { name: /^test-data$/ }).click();
	await expect(page.getByText("/test-data", { exact: true })).toBeVisible();

	const runFolderRow = page.getByRole("button", { name: new RegExp(runId) });
	await runFolderRow.locator("svg").first().click();

	const fileRow = page.getByRole("button", { name: new RegExp(escapedFileName) });
	await fileRow.getByRole("checkbox").click();
	await expect(page.getByText("1 item selected")).toBeVisible();

	await page.getByRole("button", { name: "Restore 1 item" }).click();
	await expect(page.getByText("Restore completed")).toBeVisible({ timeout: 30000 });

	const restoredContent = fs.readFileSync(restoreTargetPath, "utf8");
	expect(JSON.parse(restoredContent)).toEqual({ data: "test file" });

	fs.rmSync(restoreTargetPath, { force: true });
});

test("can re-tag a snapshot to another backup schedule", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);
	const secondBackupName = `${names.backupName}-retag`;

	prepareTestFile(runId, "retag.json");

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names);

	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	await createBackupJob(page, {
		backupName: secondBackupName,
		volumeName: names.volumeName,
		repositoryName: names.repositoryName,
	});

	await openRepositorySnapshots(page, names.repositoryName);
	await expect(page.getByRole("link", { name: names.backupName, exact: true })).toBeVisible();

	await page
		.getByRole("checkbox", { name: /Select snapshot/ })
		.first()
		.check();
	await page.getByRole("button", { name: "Re-tag" }).click();
	const retagSelect = page.getByRole("combobox");
	const retagOption = page.getByRole("option", { name: secondBackupName, exact: true });
	await expect(async () => {
		await retagSelect.click();
		await expect(retagOption).toBeVisible();
	}).toPass({ timeout: 10000 });
	await retagOption.click();
	await page.getByRole("button", { name: "Apply tags" }).click();

	await expect(page.getByText(`Snapshots re-tagged to ${secondBackupName}`)).toBeVisible({ timeout: 30000 });
	await expect(page.getByRole("link", { name: secondBackupName, exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: names.backupName, exact: true })).toHaveCount(0);
});

test("can delete a snapshot from the repository snapshots tab", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);

	prepareTestFile(runId, "delete.json");

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names);

	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	await openRepositorySnapshots(page, names.repositoryName);
	await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(1);

	await page
		.getByRole("checkbox", { name: /Select snapshot/ })
		.first()
		.check();
	await page.getByRole("button", { name: "Delete" }).click();
	await expect(page.getByText("Delete 1 snapshots?")).toBeVisible();
	await page.getByRole("button", { name: "Delete 1 snapshots" }).click();

	await expect(page.getByText("Snapshots deleted successfully")).toBeVisible({ timeout: 30000 });
	await expect(page.getByRole("checkbox", { name: /Select snapshot/ })).toHaveCount(0);
	await expect(page.getByRole("link", { name: names.backupName, exact: true })).toHaveCount(0);
});

test("can download a selected snapshot directory as a tar archive", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);
	const fileName = `download-${runId}.json`;
	const filePath = prepareTestFile(runId, fileName);
	const downloadedPath = path.join(testDataPath, `downloaded-${runId}.tar`);

	fs.rmSync(downloadedPath, { force: true });

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

	const runFolderRow = page.getByRole("button", { name: new RegExp(runId) });
	await runFolderRow.getByRole("checkbox").click();
	await expect(page.getByText("1 item selected")).toBeVisible();

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download 1 item" }).click();
	const download = await downloadPromise;

	expect(download.suggestedFilename()).toMatch(/^snapshot-.*\.tar$/);
	await download.saveAs(downloadedPath);

	const stats = fs.statSync(downloadedPath);
	expect(stats.size).toBeGreaterThan(0);

	fs.rmSync(downloadedPath, { force: true });
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

test("backup respects include globs, exclusion patterns, and exclude-if-present", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);

	const keptDir = `kept-${runId}`;
	const secondKeptDir = `second-kept-${runId}`;
	const blockedDir = `blocked-${runId}`;
	const globOnlyDir = `glob-only-${runId}`;
	const dataDir = `data-${runId}`;
	const configDir = `config-${runId}`;

	const dataIncludedFile = `data-${runId}.txt`;
	const configIncludedFile = `config-${runId}.json`;
	const configExcludedFile = `secret-${runId}.json`;
	const configNonJsonFile = `config-${runId}.txt`;
	const rootDbFile = `root-${runId}.db`;
	const secondRootDbFile = `archive-${runId}.db`;
	const rootNonDbFile = `root-${runId}.txt`;

	const keptPath = path.join(testDataPath, keptDir);
	const secondKeptPath = path.join(testDataPath, secondKeptDir);
	const blockedPath = path.join(testDataPath, blockedDir);
	const globOnlyPath = path.join(testDataPath, globOnlyDir);
	const dataPath = path.join(testDataPath, dataDir);
	const configPath = path.join(testDataPath, configDir);

	fs.mkdirSync(keptPath, { recursive: true });
	fs.mkdirSync(secondKeptPath, { recursive: true });
	fs.mkdirSync(blockedPath, { recursive: true });
	fs.mkdirSync(globOnlyPath, { recursive: true });
	fs.mkdirSync(dataPath, { recursive: true });
	fs.mkdirSync(configPath, { recursive: true });

	fs.writeFileSync(path.join(keptPath, "keep.xyz"), "xyz content");
	fs.writeFileSync(path.join(keptPath, ".DS_Store"), "excluded metadata");
	fs.writeFileSync(path.join(keptPath, "skip.tmp"), "excluded tmp");

	fs.writeFileSync(path.join(secondKeptPath, "second.xyz"), "xyz content");
	fs.writeFileSync(path.join(secondKeptPath, ".DS_Store"), "excluded metadata");

	fs.writeFileSync(path.join(blockedPath, ".nobackup"), "marker");
	fs.writeFileSync(path.join(blockedPath, "blocked.xyz"), "should be excluded");

	fs.writeFileSync(path.join(globOnlyPath, "glob-only.xyz"), "glob include");

	fs.writeFileSync(path.join(dataPath, dataIncludedFile), "data include");
	fs.writeFileSync(path.join(configPath, configIncludedFile), "json include");
	fs.writeFileSync(path.join(configPath, configExcludedFile), "json excluded by absolute exclude");
	fs.writeFileSync(path.join(configPath, configNonJsonFile), "not included by /config/*.json");

	fs.writeFileSync(path.join(testDataPath, rootDbFile), "root db include");
	fs.writeFileSync(path.join(testDataPath, secondRootDbFile), "second root db include");
	fs.writeFileSync(path.join(testDataPath, rootNonDbFile), "root non-db exclude");

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names, {
		includePatterns: [
			`/${keptDir}`,
			`/${secondKeptDir}`,
			`/${blockedDir}`,
			`/${dataDir}/**`,
			`/${configDir}/*.json`,
			"*.db",
			"**/*.xyz",
		].join("\n"),
		excludePatterns: [".DS_Store", "*.tmp", `/${configDir}/secret*.json`].join("\n"),
		excludeIfPresent: ".nobackup",
	});

	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	await page
		.getByRole("button", { name: /\d+ B$/ })
		.first()
		.click();
	await expect(page.getByText("File Browser")).toBeVisible();

	for (const folder of [keptDir, secondKeptDir, globOnlyDir, dataDir, configDir, blockedDir]) {
		const folderRow = page.getByRole("button", { name: folder, exact: true });
		await expect(folderRow).toBeVisible();
		await folderRow.locator("svg").first().click();
	}

	await expect(page.getByRole("button", { name: /keep\.xyz/ })).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole("button", { name: /second\.xyz/ })).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole("button", { name: /glob-only\.xyz/ })).toBeVisible({ timeout: 15000 });
	await expect(page.getByRole("button", { name: new RegExp(dataIncludedFile.replace(".", "\\.")) })).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByRole("button", { name: new RegExp(configIncludedFile.replace(".", "\\.")) })).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByRole("button", { name: new RegExp(rootDbFile.replace(".", "\\.")) })).toBeVisible({
		timeout: 15000,
	});
	await expect(page.getByRole("button", { name: new RegExp(secondRootDbFile.replace(".", "\\.")) })).toBeVisible({
		timeout: 15000,
	});

	await expect(page.getByRole("button", { name: /\.DS_Store/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /skip\.tmp/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: new RegExp(configExcludedFile.replace(".", "\\.")) })).toHaveCount(0);
	await expect(page.getByRole("button", { name: new RegExp(configNonJsonFile.replace(".", "\\.")) })).toHaveCount(0);
	await expect(page.getByRole("button", { name: new RegExp(rootNonDbFile.replace(".", "\\.")) })).toHaveCount(0);

	await expect(page.getByRole("button", { name: /\.nobackup/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /blocked\.xyz/ })).toHaveCount(0);
});

test("backup can include a selected folder whose name contains brackets", async ({ page }, testInfo) => {
	const runId = getRunId(testInfo);
	const names = getScenarioNames(runId);
	const bracketDir = `movies [${runId}]`;
	const bracketPath = path.join(testDataPath, bracketDir);
	const fileName = `inside-${runId}.txt`;

	fs.mkdirSync(bracketPath, { recursive: true });
	fs.writeFileSync(path.join(bracketPath, fileName), "bracket path content");

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names, {
		selectedPaths: [`/${bracketDir}`],
	});

	await page.getByRole("button", { name: "Backup now" }).click();
	await expect(page.getByText("Backup started successfully")).toBeVisible();
	await expect(page.getByText("✓ Success")).toBeVisible({ timeout: 30000 });

	await page
		.getByRole("button", { name: /\d+ B$/ })
		.first()
		.click();
	const bracketFolderRow = page.getByRole("button", {
		name: new RegExp(bracketDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
	});
	await expect(bracketFolderRow).toBeVisible();
	await bracketFolderRow.locator("svg").first().click();
	await expect(page.getByRole("button", { name: new RegExp(fileName.replace(".", "\\.")) })).toBeVisible({
		timeout: 15000,
	});
});
