import { Database } from "bun:sqlite";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";

export const ROOT_DIR = resolve(import.meta.dir, "../..");
export const LOGO_PATH = join(ROOT_DIR, "public/images/zerobyte.png");

const DAY = 24 * 60 * 60 * 1000;
const REFERENCE_NOW = Date.parse("2026-09-01T12:00:00.000Z");

// The server's scheduler runs on the real clock and executes any seeded schedule whose next backup is already due,
// so the demo timeline is shifted by whole days to keep "now" just ahead of the real date.
const TIMELINE_SHIFT = (Math.floor((Date.now() - REFERENCE_NOW) / DAY) + 1) * DAY;
export const FIXED_NOW = REFERENCE_NOW + TIMELINE_SHIFT;

export const demoTime = (referenceDate: string) => Date.parse(referenceDate) + TIMELINE_SHIFT;

const SOURCE_DATABASE = join(ROOT_DIR, "data/zerobyte.db");
const SERVER_PORT = 4399;
export const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;

export const sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

const clearDomainData = (databasePath: string) => {
	const database = new Database(databasePath);
	const clear = database.transaction(() => {
		database.run("DELETE FROM tasks");
		database.run("DELETE FROM repository_lock_waiters");
		database.run("DELETE FROM repository_locks");
		database.run("DELETE FROM snapshot_usage_scans");
		database.run("DELETE FROM backup_schedule_notifications_table");
		database.run("DELETE FROM notification_destinations_table");
		database.run("DELETE FROM backup_schedule_mirrors_table");
		database.run("DELETE FROM backup_schedules_table");
		database.run("DELETE FROM repositories_table");
		database.run("DELETE FROM volumes_table");
	});

	clear();
	database.close();
};

const seedDomainData = (databasePath: string) => {
	const database = new Database(databasePath);
	const organization = database
		.query<{ id: string }, []>("SELECT id FROM organization ORDER BY created_at LIMIT 1")
		.get();

	if (!organization) {
		throw new Error(
			"The development database has no organization. Run Zerobyte once before generating screenshots.",
		);
	}

	const organizationId = organization.id;
	const createdAt = FIXED_NOW - 90 * 24 * 60 * 60 * 1000;
	const documentsLastBackup = FIXED_NOW - 4 * 60 * 60 * 1000;
	const photosLastBackup = FIXED_NOW - 24 * 60 * 60 * 1000;
	const familyLastBackup = FIXED_NOW - 6 * 60 * 60 * 1000;
	const workLastBackup = FIXED_NOW - 12 * 60 * 60 * 1000;
	const mediaLastBackup = FIXED_NOW - 3 * 24 * 60 * 60 * 1000;
	const cloudLastBackup = FIXED_NOW - 7 * 24 * 60 * 60 * 1000;
	const nextNight = demoTime("2026-09-02T02:00:00.000Z");
	const nextPhotos = demoTime("2026-09-02T03:00:00.000Z");
	const nextFamily = demoTime("2026-09-01T18:00:00.000Z");
	const nextWork = demoTime("2026-09-02T01:30:00.000Z");
	const nextMedia = demoTime("2026-09-06T04:00:00.000Z");
	const nextCloud = demoTime("2026-10-01T05:00:00.000Z");

	const volumes = [
		[1001, "docs0001", "Documents", "directory", '{"backend":"directory","path":"/Users/alex/Documents"}'],
		[1002, "photo001", "Photo Library", "directory", '{"backend":"directory","path":"/Users/alex/Pictures"}'],
		[
			1003,
			"family01",
			"Family NAS",
			"smb",
			'{"backend":"smb","server":"nas.home","share":"Family","mapToContainerUidGid":false,"vers":"3.0","port":445}',
		],
		[
			1004,
			"work0001",
			"Work Server",
			"sftp",
			'{"backend":"sftp","host":"backup.example.com","port":22,"username":"backup","path":"/data","skipHostKeyCheck":false,"allowLegacySshRsa":false,"allowUnsafeSymlinkTargets":false}',
		],
		[
			1005,
			"cloud001",
			"Cloud Archive",
			"webdav",
			'{"backend":"webdav","server":"storage.example.com","path":"/archive","port":443,"ssl":true}',
		],
		[
			1006,
			"media001",
			"Media Vault",
			"nfs",
			'{"backend":"nfs","server":"nas.home","exportPath":"/volume/media","port":2049,"version":"4.1"}',
		],
	] as const;

	const localStats = JSON.stringify({
		total_size: 34_093_670_216,
		total_uncompressed_size: 36_480_071_579,
		compression_ratio: 1.07,
		compression_progress: 100,
		compression_space_saving: 6.54,
		snapshots_count: 128,
	});
	const b2Stats = JSON.stringify({
		total_size: 128_849_018_880,
		total_uncompressed_size: 161_061_273_600,
		compression_ratio: 1.25,
		compression_progress: 100,
		compression_space_saving: 20,
		snapshots_count: 342,
	});
	const r2Stats = JSON.stringify({
		total_size: 69_793_218_560,
		total_uncompressed_size: 85_899_345_920,
		compression_ratio: 1.23,
		compression_progress: 100,
		compression_space_saving: 18.7,
		snapshots_count: 94,
	});
	const offsiteStats = JSON.stringify({
		total_size: 193_273_528_320,
		total_uncompressed_size: 236_223_201_280,
		compression_ratio: 1.22,
		compression_progress: 100,
		compression_space_saving: 18.2,
		snapshots_count: 186,
	});
	const repositories = [
		[
			"store-local",
			"local001",
			"Local Archive",
			"local",
			'{"backend":"local","path":"/Volumes/Backup Drive/zerobyte"}',
			"auto",
			localStats,
		],
		[
			"store-b2",
			"backblz1",
			"Backblaze B2",
			"s3",
			'{"backend":"s3","endpoint":"s3.eu-central-003.backblazeb2.com","bucket":"zerobyte-backups","accessKeyId":"demo","secretAccessKey":"demo"}',
			"max",
			b2Stats,
		],
		[
			"store-r2",
			"cloudr21",
			"Cloudflare R2",
			"r2",
			'{"backend":"r2","endpoint":"https://demo.r2.cloudflarestorage.com","bucket":"offsite","accessKeyId":"demo","secretAccessKey":"demo"}',
			"auto",
			r2Stats,
		],
		[
			"store-sftp",
			"offsite1",
			"Offsite Server",
			"sftp",
			'{"backend":"sftp","host":"vault.example.com","port":22,"user":"backup","path":"/zerobyte","privateKey":"demo","skipHostKeyCheck":false}',
			"auto",
			offsiteStats,
		],
	] as const;

	const schedules = [
		[2001, "backup01", "Documents Backup", 1001, "store-local", "0 2 * * *", documentsLastBackup, nextNight],
		[2002, "backup02", "Photo Library", 1002, "store-b2", "0 3 * * *", photosLastBackup, nextPhotos],
		[2003, "backup03", "Family NAS", 1003, "store-b2", "0 */6 * * *", familyLastBackup, nextFamily],
		[2004, "backup04", "Work Projects", 1004, "store-r2", "30 1 * * *", workLastBackup, nextWork],
		[2005, "backup05", "Media Archive", 1006, "store-sftp", "0 4 * * 0", mediaLastBackup, nextMedia],
		[2006, "backup06", "Cloud Documents", 1005, "store-r2", "0 5 1 * *", cloudLastBackup, nextCloud],
	] as const;

	const insertVolume = database.query(`
		INSERT INTO volumes_table
		(id, short_id, name, type, status, last_health_check, created_at, updated_at, config, auto_remount, agent_id, organization_id)
		VALUES (?, ?, ?, ?, 'mounted', ?, ?, ?, ?, 0, 'local', ?)
	`);
	const insertRepository = database.query(`
		INSERT INTO repositories_table
		(id, short_id, name, type, config, compression_mode, status, last_checked, stats, stats_updated_at, auto_check_enabled, created_at, updated_at, organization_id)
		VALUES (?, ?, ?, ?, ?, ?, 'healthy', ?, ?, ?, 0, ?, ?, ?)
	`);
	const insertSchedule = database.query(`
		INSERT INTO backup_schedules_table
		(id, short_id, name, volume_id, repository_id, enabled, cron_expression, last_backup_at, last_backup_status, next_backup_at, sort_order, created_at, updated_at, organization_id)
		VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'success', ?, ?, ?, ?, ?)
	`);
	const seed = database.transaction(() => {
		for (const [id, shortId, name, type, config] of volumes) {
			insertVolume.run(id, shortId, name, type, FIXED_NOW, createdAt, FIXED_NOW, config, organizationId);
		}

		for (const [id, shortId, name, type, config, compression, stats] of repositories) {
			insertRepository.run(
				id,
				shortId,
				name,
				type,
				config,
				compression,
				FIXED_NOW,
				stats,
				FIXED_NOW,
				createdAt,
				FIXED_NOW,
				organizationId,
			);
		}

		for (const [id, shortId, name, volumeId, repositoryId, cron, lastBackup, nextBackup] of schedules) {
			const sortOrder = id - 2001;
			insertSchedule.run(
				id,
				shortId,
				name,
				volumeId,
				repositoryId,
				cron,
				lastBackup,
				nextBackup,
				sortOrder,
				createdAt,
				FIXED_NOW,
				organizationId,
			);
		}

		database.run(
			`INSERT INTO backup_schedule_mirrors_table
			(schedule_id, repository_id, enabled, last_copy_at, last_copy_status, created_at)
			VALUES (?, ?, 1, ?, 'success', ?)`,
			[2001, "store-b2", FIXED_NOW - 2 * 24 * 60 * 60 * 1000, createdAt],
		);
	});

	seed();
	database.close();
};

const waitForServer = async () => {
	for (let attempt = 0; attempt < 120; attempt += 1) {
		try {
			const response = await fetch(`${BASE_URL}/login`);
			if (response.ok) return;
		} catch {
			// The server is still starting.
		}
		await sleep(250);
	}

	throw new Error(`Timed out waiting for ${BASE_URL}`);
};

export const removeCaptureNoise = async (page: Page) => {
	await page.locator('button[aria-label*="Up to date"]').waitFor();
	const style = `
		*, *::before, *::after {
			animation: none !important;
			transition: none !important;
			caret-color: transparent !important;
		}
		.tsqd-parent-container { display: none !important; }
	`;
	await page.addStyleTag({ content: style });
	const dismissReminder = page.getByRole("button", { name: "Dismiss recovery key reminder" });
	if (await dismissReminder.isVisible()) await dismissReminder.click();
	await page
		.locator(".tsqd-parent-container")
		.evaluateAll((elements) => elements.forEach((element) => element.remove()));
	await page.evaluate(() => document.fonts.ready);
	await sleep(200);
};

export const captureCurrentPage = async (page: Page, waitFor: string, outputPath: string) => {
	await page.getByText(waitFor, { exact: false }).first().waitFor();
	await removeCaptureNoise(page);
	await page.screenshot({ path: outputPath, fullPage: false });
};

export const createSnapshot = (shortId: string, time: number, size: number) => {
	const backupStart = new Date(time).toISOString();
	const backupEnd = new Date(time + 42_000).toISOString();
	return {
		short_id: shortId,
		paths: ["/data/volumes/docs0001/_data"],
		tags: ["backup01"],
		time,
		size,
		duration: 42,
		retentionCategories: ["daily"],
		summary: {
			files_new: 48,
			files_changed: 17,
			files_unmodified: 12_430,
			dirs_new: 6,
			dirs_changed: 3,
			dirs_unmodified: 842,
			data_blobs: 112,
			tree_blobs: 24,
			data_added: 184_549_376,
			data_added_packed: 143_654_912,
			total_files_processed: 12_495,
			total_bytes_processed: size,
			backup_start: backupStart,
			backup_end: backupEnd,
		},
	};
};

export const startDemoApp = async () => {
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "zerobyte-screenshots-"));
	const screenshotDatabase = join(temporaryDirectory, "zerobyte.db");
	await copyFile(SOURCE_DATABASE, screenshotDatabase);
	clearDomainData(screenshotDatabase);

	const serverEnvironment = {
		...process.env,
		NODE_ENV: "development",
		PORT: String(SERVER_PORT),
		BASE_URL,
		TRUSTED_ORIGINS: BASE_URL,
		ZEROBYTE_DATABASE_URL: screenshotDatabase,
		ENABLE_DEV_PANEL: "false",
		ENABLE_LOCAL_AGENT: "false",
	};
	const server = Bun.spawn(
		["bunx", "--bun", "vite", "--port", String(SERVER_PORT), "--strictPort", "--host", "127.0.0.1"],
		{
			cwd: ROOT_DIR,
			env: serverEnvironment,
			stdout: "ignore",
			stderr: "inherit",
		},
	);

	const stop = async () => {
		server.kill();
		await server.exited;
		await rm(temporaryDirectory, { recursive: true, force: true });
	};

	try {
		await waitForServer();
		seedDomainData(screenshotDatabase);
	} catch (error) {
		await stop();
		throw error;
	}

	return { stop };
};

type DemoPageOptions = {
	width: number;
	height: number;
	deviceScaleFactor?: number;
};

export const openDemoPage = async (browser: Browser, options: DemoPageOptions) => {
	const { width, height, deviceScaleFactor = 1 } = options;

	// Every published screenshot uses the dark theme, including in light-themed READMEs and stores.
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor, colorScheme: "dark" });
	await context.addCookies([{ name: "theme", value: "dark", url: BASE_URL }]);

	const page = await context.newPage();
	await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
	await sleep(750);
	await page.getByLabel("Username").fill("admin");
	await page.getByLabel("Password").fill("password");
	await page.getByRole("button", { name: "Login" }).click();
	await page.waitForURL(`${BASE_URL}/volumes`);
	await page.clock.setFixedTime(FIXED_NOW);

	return page;
};

const SNAPSHOTS_PATTERN = /\/api\/v1\/repositories\/[^/]+\/snapshots(?:\?.*)?$/;

export const mockSnapshots = async (page: Page, snapshots: ReturnType<typeof createSnapshot>[]) => {
	const body = JSON.stringify(snapshots);

	await page.route(SNAPSHOTS_PATTERN, async (route) => {
		await route.fulfill({ status: 200, contentType: "application/json", body });
	});
};

export const documentsSnapshots = [
	createSnapshot("snap-0822", demoTime("2026-08-22T16:56:00.000Z"), 4_187_593_728),
	createSnapshot("snap-0825a", demoTime("2026-08-25T06:13:00.000Z"), 4_194_304_000),
	createSnapshot("snap-0825b", demoTime("2026-08-25T19:36:00.000Z"), 4_201_014_272),
	createSnapshot("snap-0901", demoTime("2026-09-01T08:00:00.000Z"), 4_247_044_096),
];
