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
	if (options.includePatterns) {
		await page.getByLabel("Additional include patterns").fill(options.includePatterns);
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

	await gotoAndWaitForAppReady(page, "/");
	await expect(page).toHaveURL("/volumes");

	await createBackupScenario(page, names, {
		includePatterns: [
			`/${keptDir}`,
			`/${secondKeptDir}`,
			`/${blockedDir}`,
			`/${dataDir}/**`,
			`/${configDir}/*.json`,
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

	await expect(page.getByRole("button", { name: /keep\.xyz/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /second\.xyz/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /glob-only\.xyz/ })).toBeVisible();
	await expect(page.getByRole("button", { name: new RegExp(dataIncludedFile.replace(".", "\\.")) })).toBeVisible();
	await expect(page.getByRole("button", { name: new RegExp(configIncludedFile.replace(".", "\\.")) })).toBeVisible();

	await expect(page.getByRole("button", { name: /\.DS_Store/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /skip\.tmp/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: new RegExp(configExcludedFile.replace(".", "\\.")) })).toHaveCount(0);
	await expect(page.getByRole("button", { name: new RegExp(configNonJsonFile.replace(".", "\\.")) })).toHaveCount(0);

	await expect(page.getByRole("button", { name: /\.nobackup/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: /blocked\.xyz/ })).toHaveCount(0);
});
