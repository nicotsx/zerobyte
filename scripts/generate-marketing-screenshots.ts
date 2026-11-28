import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import {
	BASE_URL,
	ROOT_DIR,
	createSnapshot,
	demoTime,
	mockSnapshots,
	openDemoPage,
	removeCaptureNoise,
	startDemoApp,
} from "./screenshots/demo-app";

const README_DIR = join(ROOT_DIR, "screenshots/readme");
const HERO_CAPTURE = "backups";
const HERO_WIDTH = 1280;
const FEATURE_WIDTH = 1120;
const INITIAL_HEIGHT = 700;
const CAPTURE_SCALE = 2;
const WEBP_QUALITY = 0.92;

const SOURCE_PATH = "/Users/alex/Documents";
const MIRRORS_PATTERN = /\/api\/v1\/backups\/[^/]+\/mirrors$/;
const FILES_PATTERN = /\/api\/v1\/repositories\/[^/]+\/snapshots\/[^/]+\/files(?:\?.*)?$/;

const snapshotSpecs = [
	["8f3a1c2e", "2026-06-01T02:00:00.000Z", 3_902_341_120, ["monthly"]],
	["b71d09aa", "2026-07-01T02:00:00.000Z", 3_968_147_456, ["monthly"]],
	["2c9e44f1", "2026-08-01T02:00:00.000Z", 4_054_833_152, ["monthly"]],
	["e05b7d13", "2026-08-16T02:00:00.000Z", 4_121_493_504, ["weekly"]],
	["5a6f2b90", "2026-08-23T02:00:00.000Z", 4_163_207_168, ["weekly"]],
	["c4d81e77", "2026-08-29T02:00:00.000Z", 4_201_014_272, ["daily"]],
	["91be3f05", "2026-08-30T02:00:00.000Z", 4_218_421_248, ["daily", "weekly"]],
	["7d20a6c8", "2026-08-31T02:00:00.000Z", 4_231_917_568, ["daily"]],
	["f6a9c3d4", "2026-09-01T02:00:00.000Z", 4_247_044_096, ["daily", "monthly"]],
] as const;

const snapshots = snapshotSpecs.map(([shortId, time, size, retentionCategories]) => ({
	...createSnapshot(shortId, demoTime(time), size),
	paths: [SOURCE_PATH],
	hostname: "homelab",
	retentionCategories: [...retentionCategories],
}));

const snapshotFiles = [
	["Finances", "dir", 0, "2026-08-28T17:12:00.000Z"],
	["Invoices", "dir", 0, "2026-08-30T09:41:00.000Z"],
	["Projects", "dir", 0, "2026-08-31T21:05:00.000Z"],
	["Taxes", "dir", 0, "2026-04-14T10:30:00.000Z"],
	["Travel", "dir", 0, "2026-07-19T14:22:00.000Z"],
	["2025-tax-return.pdf", "file", 3_145_728, "2026-03-28T19:04:00.000Z"],
	["budget-2026.xlsx", "file", 284_672, "2026-08-31T18:47:00.000Z"],
	["car-registration.pdf", "file", 655_360, "2025-09-02T10:11:00.000Z"],
	["home-inventory.xlsx", "file", 97_280, "2026-05-17T15:38:00.000Z"],
	["insurance-policy.pdf", "file", 1_843_200, "2026-02-03T08:15:00.000Z"],
	["lease-agreement.pdf", "file", 2_516_582, "2025-11-21T16:02:00.000Z"],
	["notes.md", "file", 18_944, "2026-08-31T22:10:00.000Z"],
	["passport-scan.pdf", "file", 4_089_446, "2025-06-09T11:33:00.000Z"],
	["warranty-nas.pdf", "file", 912_384, "2026-01-12T13:26:00.000Z"],
] as const;

const mockSnapshotFiles = async (page: Page) => {
	const latestSnapshot = snapshots[snapshots.length - 1];
	const files = snapshotFiles.map(([name, type, size, modifiedAt]) => ({
		name,
		type,
		path: `${SOURCE_PATH}/${name}`,
		size,
		mtime: new Date(demoTime(modifiedAt)).toISOString(),
	}));

	await page.route(FILES_PATTERN, async (route) => {
		const requestedPath = new URL(route.request().url()).searchParams.get("path");
		const isSourceRoot = requestedPath === SOURCE_PATH;
		const listedFiles = isSourceRoot ? files : [];

		const body = JSON.stringify({
			snapshot: {
				id: latestSnapshot.short_id,
				short_id: latestSnapshot.short_id,
				time: new Date(latestSnapshot.time).toISOString(),
				hostname: latestSnapshot.hostname,
				paths: latestSnapshot.paths,
			},
			files: listedFiles,
			offset: 0,
			limit: 500,
			total: listedFiles.length,
			hasMore: false,
		});
		await route.fulfill({ status: 200, contentType: "application/json", body });
	});
};

const mockMirrorSync = async (page: Page) => {
	const lastSyncTask = {
		id: "mirror-sync-demo",
		status: "succeeded",
		error: null,
		finishedAt: demoTime("2026-09-01T08:05:00.000Z"),
	};

	await page.route(MIRRORS_PATTERN, async (route) => {
		const response = await route.fetch();
		const mirrors: Record<string, unknown>[] = await response.json();
		const syncedMirrors = mirrors.map((mirror) => ({ ...mirror, lastSyncTask }));

		await route.fulfill({ response, json: syncedMirrors });
	});
};

const fitViewportTo = async (page: Page, lastVisibleElement: Locator, bottomMargin = 24) => {
	const box = await lastVisibleElement.boundingBox();
	if (!box) throw new Error("Cannot fit the viewport to an element that is not rendered");

	const width = page.viewportSize()?.width ?? FEATURE_WIDTH;
	const height = Math.ceil(box.y + box.height + bottomMargin);
	await page.setViewportSize({ width, height });
};

const scrollBelowHeader = async (firstVisibleElement: Locator, topMargin: number) => {
	await firstVisibleElement.evaluate((element, topMargin) => {
		let scroller = element.parentElement;
		while (scroller && !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)) {
			scroller = scroller.parentElement;
		}
		if (!scroller) throw new Error("The element is not inside a scrollable container");

		const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		scroller.scrollTop += offset - topMargin;
	}, topMargin);
};

const capture = async (page: Page) => {
	await page.mouse.move(0, 0);
	await removeCaptureNoise(page);
	return page.screenshot({ fullPage: false });
};

const navigateTo = async (page: Page, navLabel: string, route: string) => {
	await page.getByRole("link", { name: navLabel, exact: true }).click();
	await page.waitForURL(`${BASE_URL}${route}`);
};

type Capture = {
	name: string;
	width: number;
	screenshot: Buffer;
};

const captureApp = async (browser: Browser) => {
	const page = await openDemoPage(browser, {
		width: FEATURE_WIDTH,
		height: INITIAL_HEIGHT,
		deviceScaleFactor: CAPTURE_SCALE,
	});
	await mockSnapshots(page, snapshots);
	await mockSnapshotFiles(page);
	await mockMirrorSync(page);

	const captures: Capture[] = [];
	const card = (text: string | RegExp) => page.locator('[data-slot="card"]').filter({ hasText: text });

	const sourcesFooter = page.getByText("6 sources", { exact: false }).first();
	await sourcesFooter.waitFor();
	await fitViewportTo(page, sourcesFooter);
	captures.push({ name: "sources", width: FEATURE_WIDTH, screenshot: await capture(page) });

	await page.setViewportSize({ width: HERO_WIDTH, height: INITIAL_HEIGHT });
	await navigateTo(page, "Backups", "/backups");
	const lastBackupJob = page.getByRole("link", { name: /Cloud Documents/ });
	await lastBackupJob.waitFor();
	await fitViewportTo(page, lastBackupJob, 16);
	captures.push({ name: "backups", width: HERO_WIDTH, screenshot: await capture(page) });

	await page.setViewportSize({ width: FEATURE_WIDTH, height: INITIAL_HEIGHT });
	await navigateTo(page, "Repositories", "/repositories");
	await page.getByText("4 repositories", { exact: false }).first().waitFor();
	await page.getByText("Backblaze B2").first().click();
	await page.waitForURL(`${BASE_URL}/repositories/backblz1`);
	await page.getByText("Compression Statistics", { exact: true }).waitFor();
	await fitViewportTo(page, card("Compression Statistics"));
	captures.push({ name: "repository", width: FEATURE_WIDTH, screenshot: await capture(page) });

	await page.setViewportSize({ width: FEATURE_WIDTH, height: INITIAL_HEIGHT });
	await navigateTo(page, "Backups", "/backups");
	await page.getByRole("link", { name: /Documents Backup/ }).click();
	await page.waitForURL(`${BASE_URL}/backups/backup01`);
	await page.locator("button[aria-pressed]").last().click();
	await page.getByText("budget-2026.xlsx").waitFor();
	await scrollBelowHeader(card("Documents Backup").first(), 24);
	await fitViewportTo(page, page.getByText("9 snapshots", { exact: false }));
	captures.push({ name: "schedule", width: FEATURE_WIDTH, screenshot: await capture(page) });

	await page.setViewportSize({ width: FEATURE_WIDTH, height: INITIAL_HEIGHT });
	await scrollBelowHeader(card(/data added/i), 14);
	await fitViewportTo(page, card("File Browser"));
	captures.push({ name: "restore", width: FEATURE_WIDTH, screenshot: await capture(page) });

	await page.context().close();
	return captures;
};

const BACKDROP = `radial-gradient(circle at 85% 0%, rgba(255, 129, 80, .34), transparent 42%),
	radial-gradient(circle at 8% 100%, rgba(255, 70, 48, .2), transparent 45%),
	linear-gradient(138deg, #21100e 0%, #100d0d 48%, #090909 100%)`;
const WINDOW_SHADOW = "0 28px 70px rgba(0, 0, 0, .62), 0 0 60px rgba(255, 88, 56, .12)";

const buildFrameHtml = (screenshotUrl: string, width: number, withBackdrop: boolean) => {
	const padding = withBackdrop ? 56 : 0;
	const frameBackground = withBackdrop ? BACKDROP : "transparent";
	const windowShadow = withBackdrop ? WINDOW_SHADOW : "none";

	return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; background: transparent; }
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .frame {
        width: ${width + padding * 2}px;
        padding: ${padding}px;
        border-radius: ${withBackdrop ? 20 : 0}px;
        background: ${frameBackground};
      }
      .window {
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, .16);
        border-radius: 12px;
        box-shadow: ${windowShadow};
      }
      .chrome {
        position: relative;
        height: 36px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 14px;
        background: linear-gradient(#282525, #1b1919);
        border-bottom: 1px solid rgba(255, 255, 255, .08);
      }
      .dot { width: 11px; height: 11px; border-radius: 50%; }
      .red { background: #ff5f57; }
      .amber { background: #febc2e; }
      .green { background: #28c840; }
      .title {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        color: rgba(255, 255, 255, .5);
        font-size: 12px;
        font-weight: 600;
      }
      .window img { display: block; width: 100%; height: auto; }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="window">
        <div class="chrome">
          <span class="dot red"></span><span class="dot amber"></span><span class="dot green"></span>
          <span class="title">Zerobyte</span>
        </div>
        <img src="${screenshotUrl}" alt="" />
      </div>
    </div>
  </body>
</html>
`;
};

const encodeWebp = async (page: Page, png: Buffer) => {
	const pngUrl = `data:image/png;base64,${png.toString("base64")}`;

	const webpUrl = await page.evaluate(
		async ({ source, quality }) => {
			const image = new Image();
			image.src = source;
			await image.decode();

			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;

			const context = canvas.getContext("2d");
			if (!context) throw new Error("Cannot encode a screenshot without a 2D canvas context");
			context.drawImage(image, 0, 0);

			return canvas.toDataURL("image/webp", quality);
		},
		{ source: pngUrl, quality: WEBP_QUALITY },
	);

	return Buffer.from(webpUrl.split(",")[1], "base64");
};

const renderFrame = async (page: Page, { width, screenshot }: Capture, withBackdrop: boolean) => {
	const screenshotUrl = `data:image/png;base64,${screenshot.toString("base64")}`;
	const html = buildFrameHtml(screenshotUrl, width, withBackdrop);

	await page.setContent(html, { waitUntil: "load" });
	await page.evaluate(async () => {
		await Promise.all(Array.from(document.images).map((image) => image.decode()));
	});

	return page.locator(".frame").screenshot({ omitBackground: true });
};

const writeReadmeImage = async (page: Page, appCapture: Capture) => {
	const withBackdrop = appCapture.name === HERO_CAPTURE;
	const frame = await renderFrame(page, appCapture, withBackdrop);

	await writeFile(join(README_DIR, `${appCapture.name}.webp`), await encodeWebp(page, frame));
};

const main = async () => {
	await mkdir(README_DIR, { recursive: true });
	const demoApp = await startDemoApp();

	let browser;
	try {
		browser = await chromium.launch({ headless: true });

		const captures = await captureApp(browser);

		const frameContext = await browser.newContext({
			viewport: { width: HERO_WIDTH + 200, height: 900 },
			deviceScaleFactor: CAPTURE_SCALE,
		});
		const framePage = await frameContext.newPage();

		for (const appCapture of captures) {
			await writeReadmeImage(framePage, appCapture);
		}

		await frameContext.close();
	} finally {
		await browser?.close();
		await demoApp.stop();
	}
};

await main();
