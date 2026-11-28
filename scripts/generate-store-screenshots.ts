import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import {
	BASE_URL,
	LOGO_PATH,
	ROOT_DIR,
	captureCurrentPage,
	documentsSnapshots,
	mockSnapshots,
	openDemoPage,
	removeCaptureNoise,
	startDemoApp,
} from "./screenshots/demo-app";

const OUTPUT_DIR = join(ROOT_DIR, "screenshots/app-store");
const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const STORE_WIDTH = 2560;
const STORE_HEIGHT = 1600;

const captureSpecs = [
	{
		route: "/volumes",
		navLabel: "Volumes",
		waitFor: "6 sources",
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
	const demoApp = await startDemoApp();

	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const appPage = await openDemoPage(browser, { width: APP_WIDTH, height: APP_HEIGHT });

		const volumeSpec = captureSpecs[0];
		const volumeRawPath = join(OUTPUT_DIR, volumeSpec.rawFile);
		await captureCurrentPage(appPage, volumeSpec.waitFor, volumeRawPath);

		for (const spec of captureSpecs.slice(1)) {
			await appPage.getByRole("link", { name: spec.navLabel, exact: true }).click();
			await appPage.waitForURL(`${BASE_URL}${spec.route}`);
			const rawPath = join(OUTPUT_DIR, spec.rawFile);
			await captureCurrentPage(appPage, spec.waitFor, rawPath);
		}

		await mockSnapshots(appPage, documentsSnapshots);
		await appPage.getByRole("link", { name: /Documents Backup/ }).click();
		await appPage.waitForURL(`${BASE_URL}/backups/backup01`);
		await appPage.getByText("Snapshots", { exact: true }).waitFor();
		await removeCaptureNoise(appPage);
		const detailsRawPath = join(OUTPUT_DIR, detailsSpec.rawFile);
		await appPage.screenshot({ path: detailsRawPath, fullPage: false });
		await appPage.context().close();

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
		await demoApp.stop();
	}
};

await main();
