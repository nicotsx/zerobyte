import { Database } from "bun:sqlite";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const ROOT_DIR = resolve(import.meta.dir, "..");
const SOURCE_DATABASE = join(ROOT_DIR, "data/zerobyte.db");
const OUTPUT_DIR = join(ROOT_DIR, "screenshots/app-store");
const LOGO_PATH = join(ROOT_DIR, "public/images/zerobyte.png");
const SERVER_PORT = 4399;
const BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;
const FIXED_NOW = Date.parse("2026-09-01T12:00:00.000Z");
const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const STORE_WIDTH = 2560;
const STORE_HEIGHT = 1600;

const captureSpecs = [
	{
		route: "/volumes",
		navLabel: "Volumes",
		waitFor: "6 volumes",
		rawFile: "01-volumes.png",
		storeFile: "01-volumes-store.png",
		title: "Your files",
		accent: "Backed up simply",
		subtitle: "Choose what matters. Zerobyte handles the rest.",
	},
	{
		route: "/repositories",
		navLabel: "Repositories",
		waitFor: "4 repositories",
		rawFile: "02-repositories.png",
		storeFile: "02-repositories-store.png",
		title: "Your storage",
		accent: "Your choice",
		subtitle: "Keep backups locally or off-site, without cloud lock-in.",
	},
	{
		route: "/backups",
		navLabel: "Backups",
		waitFor: "Documents Backup",
		rawFile: "03-backups.png",
		storeFile: "03-backups-store.png",
		title: "Set it once",
		accent: "Stay protected",
		subtitle: "Automatic schedules keep every important file covered.",
	},
];

const detailsSpec = {
	rawFile: "04-backup-details.png",
	storeFile: "04-backup-details-store.png",
	title: "Every backup",
	accent: "Easy to verify",
	subtitle: "See status, history, and recovery points at a glance.",
};

const sleep = (milliseconds: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

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
	const nextNight = Date.parse("2026-09-02T02:00:00.000Z");
	const nextPhotos = Date.parse("2026-09-02T03:00:00.000Z");
	const nextFamily = Date.parse("2026-09-01T18:00:00.000Z");
	const nextWork = Date.parse("2026-09-02T01:30:00.000Z");
	const nextMedia = Date.parse("2026-09-06T04:00:00.000Z");
	const nextCloud = Date.parse("2026-10-01T05:00:00.000Z");

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

const removeCaptureNoise = async (page: Page) => {
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

const captureCurrentPage = async (page: Page, waitFor: string, outputPath: string) => {
	await page.getByText(waitFor, { exact: false }).first().waitFor();
	await removeCaptureNoise(page);
	await page.screenshot({ path: outputPath, fullPage: false });
};

const createSnapshot = (shortId: string, time: number, size: number) => {
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

const buildMarketingHtml = (
	title: string,
	accent: string,
	subtitle: string,
	screenshotUrl: string,
	logoUrl: string,
) => {
	return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; width: ${STORE_WIDTH}px; height: ${STORE_HEIGHT}px; overflow: hidden; }
      body {
        color: #fff8f3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 83% 15%, rgba(255, 129, 80, .31), transparent 31%),
          radial-gradient(circle at 13% 85%, rgba(255, 70, 48, .18), transparent 35%),
          linear-gradient(138deg, #21100e 0%, #100d0d 48%, #090909 100%);
        position: relative;
      }
      body::before {
        content: "";
        position: absolute;
        inset: 0;
        opacity: .18;
        background-image:
          linear-gradient(rgba(255,255,255,.05) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px);
        background-size: 72px 72px;
        mask-image: linear-gradient(to bottom, black, transparent 78%);
      }
      .copy { position: absolute; top: 108px; left: 176px; z-index: 2; }
      .brand {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 40px;
        color: #ff8b64;
        font-size: 30px;
        font-weight: 750;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .brand-logo {
        width: 35px;
        height: 49px;
        object-fit: contain;
        filter: drop-shadow(0 0 22px rgba(255, 101, 69, .5));
      }
      h1 {
        margin: 0;
        max-width: 1500px;
        font-size: 112px;
        line-height: .98;
        letter-spacing: -.055em;
        font-weight: 780;
      }
      .accent { color: #ff7754; }
      p {
        margin: 34px 0 0;
        color: rgba(255, 244, 237, .72);
        font-size: 34px;
        line-height: 1.35;
        letter-spacing: -.015em;
      }
      .pill {
        position: absolute;
        right: 176px;
        top: 154px;
        z-index: 2;
        padding: 18px 28px;
        border: 1px solid rgba(255, 143, 105, .35);
        border-radius: 999px;
        color: #ffc1ad;
        background: rgba(255, 107, 74, .09);
        font-size: 24px;
        font-weight: 650;
      }
      .window {
        position: absolute;
        z-index: 2;
        top: 532px;
        left: 172px;
        width: 2216px;
        height: 1385px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 30px;
        background: #111;
        box-shadow:
          0 70px 160px rgba(0, 0, 0, .68),
          0 0 0 1px rgba(255, 105, 72, .08),
          0 0 100px rgba(255, 88, 56, .13);
      }
      .chrome {
        height: 58px;
        display: flex;
        align-items: center;
        gap: 13px;
        padding: 0 25px;
        background: linear-gradient(#282525, #1b1919);
        border-bottom: 1px solid rgba(255, 255, 255, .08);
      }
      .dot { width: 16px; height: 16px; border-radius: 50%; }
      .red { background: #ff5f57; }
      .amber { background: #febc2e; }
      .green { background: #28c840; }
      .window-title {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255,255,255,.56);
        font-size: 18px;
        font-weight: 600;
      }
      .window img { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <div class="copy">
      <div class="brand"><img class="brand-logo" src="${logoUrl}" alt="" />Zerobyte</div>
      <h1>${title}<br /><span class="accent">${accent}</span></h1>
      <p>${subtitle}</p>
    </div>
    <div class="pill">Private · Encrypted · Yours</div>
    <div class="window">
      <div class="chrome">
        <span class="dot red"></span><span class="dot amber"></span><span class="dot green"></span>
        <span class="window-title">Zerobyte</span>
      </div>
      <img src="${screenshotUrl}" alt="" />
    </div>
  </body>
</html>
`;
};

const renderMarketingImage = async (
	page: Page,
	title: string,
	accent: string,
	subtitle: string,
	rawPath: string,
	outputPath: string,
) => {
	const screenshot = await readFile(rawPath);
	const logo = await readFile(LOGO_PATH);
	const screenshotUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
	const logoUrl = `data:image/png;base64,${logo.toString("base64")}`;
	const html = buildMarketingHtml(title, accent, subtitle, screenshotUrl, logoUrl);
	await page.setContent(html, { waitUntil: "load" });
	await page.evaluate(async () => {
		await document.fonts.ready;
		await Promise.all(Array.from(document.images).map((image) => image.decode()));
	});
	await page.screenshot({ path: outputPath, fullPage: false });
};

const main = async () => {
	await mkdir(OUTPUT_DIR, { recursive: true });
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "zerobyte-store-screenshots-"));
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

	let browser;
	try {
		await waitForServer();
		seedDomainData(screenshotDatabase);

		browser = await chromium.launch({ headless: true });
		const appViewport = { width: APP_WIDTH, height: APP_HEIGHT };
		const appContext = await browser.newContext({ viewport: appViewport, colorScheme: "dark" });
		const appPage = await appContext.newPage();
		await appPage.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
		await sleep(750);
		await appPage.getByLabel("Username").fill("admin");
		await appPage.getByLabel("Password").fill("password");
		await appPage.getByRole("button", { name: "Login" }).click();
		await appPage.waitForURL(`${BASE_URL}/volumes`);
		await appPage.clock.setFixedTime(FIXED_NOW);

		const volumeSpec = captureSpecs[0];
		const volumeRawPath = join(OUTPUT_DIR, volumeSpec.rawFile);
		await captureCurrentPage(appPage, volumeSpec.waitFor, volumeRawPath);

		for (const spec of captureSpecs.slice(1)) {
			await appPage.getByRole("link", { name: spec.navLabel, exact: true }).click();
			await appPage.waitForURL(`${BASE_URL}${spec.route}`);
			const rawPath = join(OUTPUT_DIR, spec.rawFile);
			await captureCurrentPage(appPage, spec.waitFor, rawPath);
		}

		const snapshotOne = createSnapshot("snap-0822", Date.parse("2026-08-22T16:56:00.000Z"), 4_187_593_728);
		const snapshotTwo = createSnapshot("snap-0825a", Date.parse("2026-08-25T06:13:00.000Z"), 4_194_304_000);
		const snapshotThree = createSnapshot("snap-0825b", Date.parse("2026-08-25T19:36:00.000Z"), 4_201_014_272);
		const snapshotFour = createSnapshot("snap-0901", Date.parse("2026-09-01T08:00:00.000Z"), 4_247_044_096);
		const snapshots = [snapshotOne, snapshotTwo, snapshotThree, snapshotFour];
		const snapshotsBody = JSON.stringify(snapshots);
		const snapshotsPattern = /\/api\/v1\/repositories\/[^/]+\/snapshots(?:\?.*)?$/;
		await appPage.route(snapshotsPattern, async (route) => {
			await route.fulfill({ status: 200, contentType: "application/json", body: snapshotsBody });
		});
		await appPage.getByRole("link", { name: /Documents Backup/ }).click();
		await appPage.waitForURL(`${BASE_URL}/backups/backup01`);
		await appPage.getByText("Snapshots", { exact: true }).waitFor();
		await removeCaptureNoise(appPage);
		const detailsRawPath = join(OUTPUT_DIR, detailsSpec.rawFile);
		await appPage.screenshot({ path: detailsRawPath, fullPage: false });
		await appContext.close();

		const storeViewport = { width: STORE_WIDTH, height: STORE_HEIGHT };
		const storeContext = await browser.newContext({ viewport: storeViewport });
		const storePage = await storeContext.newPage();
		for (const spec of captureSpecs) {
			const rawPath = join(OUTPUT_DIR, spec.rawFile);
			const outputPath = join(OUTPUT_DIR, spec.storeFile);
			await renderMarketingImage(storePage, spec.title, spec.accent, spec.subtitle, rawPath, outputPath);
		}
		const detailsStorePath = join(OUTPUT_DIR, detailsSpec.storeFile);
		await renderMarketingImage(
			storePage,
			detailsSpec.title,
			detailsSpec.accent,
			detailsSpec.subtitle,
			detailsRawPath,
			detailsStorePath,
		);
		await storeContext.close();
	} finally {
		await browser?.close();
		server.kill();
		await server.exited;
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
};

await main();
