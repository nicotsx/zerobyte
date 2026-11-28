import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const DOCS_APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const ROOT_DIR = join(DOCS_APP_DIR, "../..");
const CONTENT_DIR = join(DOCS_APP_DIR, "content/docs");
const OUTPUT_DIR = join(DOCS_APP_DIR, "src/assets/og");
// The README hero, which frames the app window in a 56px backdrop at 2x scale (see scripts/generate-marketing-screenshots.ts).
const HERO_SCREENSHOT = join(ROOT_DIR, "screenshots/readme/backups.webp");
const HERO_WINDOW = { inset: 112, width: 2560, height: 1182, radius: 24 };
const LOGO_PATH = join(DOCS_APP_DIR, "public/zerobyte.png");
const FONTS_DIR = join(DOCS_APP_DIR, "node_modules/@fontsource-variable");

const WIDTH = 1200;
const HEIGHT = 630;
const HOME_SCREENSHOT_WIDTH = 1056;
const JPEG_QUALITY = 90;

type Card = {
	// Path of the page on the website, which is also where its image is written under the output directory.
	path: string;
	eyebrow: string;
	title: string;
	description: string;
};

const sectionLabels: Record<string, string> = {
	concepts: "Concepts",
	guides: "Guides",
};

const staticCards: Card[] = [
	{
		path: "/privacy",
		eyebrow: "Legal",
		title: "Privacy Policy",
		description: "How Zerobyte handles data in the desktop app and on zerobyte.app.",
	},
];

const escapeHtml = (value: string) =>
	value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const toDataUrl = async (path: string, mimeType: string) => {
	const file = await readFile(path);
	return `data:${mimeType};base64,${file.toString("base64")}`;
};

const readFrontmatter = (source: string, field: string) => {
	const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
	const value = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, "m"))?.[1] ?? "";

	return value.trim().replace(/^["']|["']$/g, "");
};

const listMdxFiles = async (directory: string): Promise<string[]> => {
	const entries = await readdir(directory, { withFileTypes: true });

	const nested = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory()) return listMdxFiles(entryPath);

			return entry.name.endsWith(".mdx") ? [entryPath] : [];
		}),
	);

	return nested.flat();
};

const readDocsCards = async (): Promise<Card[]> => {
	const files = await listMdxFiles(CONTENT_DIR);

	return Promise.all(
		files.map(async (file) => {
			const source = await readFile(file, "utf8");
			const slug = relative(CONTENT_DIR, file).replace(/\.mdx$/, "");
			const section = sectionLabels[dirname(slug)];

			return {
				path: slug === "index" ? "/docs" : `/docs/${slug}`,
				eyebrow: section ? `Docs · ${section}` : "Docs",
				title: readFrontmatter(source, "title"),
				description: readFrontmatter(source, "description"),
			};
		}),
	);
};

const buildBaseStyles = (fonts: { sans: string; mono: string }) => `
	@font-face { font-family: "Geist"; font-weight: 100 900; src: url(${fonts.sans}) format("woff2"); }
	@font-face { font-family: "JetBrains Mono"; font-weight: 100 800; src: url(${fonts.mono}) format("woff2"); }

	* { box-sizing: border-box; margin: 0; }

	body {
		width: ${WIDTH}px;
		height: ${HEIGHT}px;
		overflow: hidden;
		position: relative;
		background: #0b0b0b;
		color: #fafafa;
		font-family: "Geist", sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.grid {
		position: absolute;
		inset: 0;
		background-image:
			linear-gradient(to right, rgba(255, 255, 255, 0.055) 1px, transparent 1px),
			linear-gradient(to bottom, rgba(255, 255, 255, 0.055) 1px, transparent 1px);
		background-size: 42px 42px;
		mask-image: radial-gradient(ellipse 90% 90% at 20% 0%, black 30%, transparent 85%);
	}

	.glow {
		position: absolute;
		right: -220px;
		bottom: -320px;
		width: 900px;
		height: 760px;
		background: radial-gradient(ellipse at center, rgba(255, 84, 58, 0.34) 0%, rgba(255, 84, 58, 0.1) 40%, transparent 70%);
	}

	.brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
	.brand img { width: 44px; height: 44px; }

	.eyebrow {
		font-family: "JetBrains Mono", monospace;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #ff543a;
	}

	.accent { color: #ff543a; }
`;

const buildPageCardHtml = (card: Card, baseStyles: string, logo: string) => {
	let titleSize = 76;
	if (card.title.length > 22) titleSize = 64;
	if (card.title.length > 36) titleSize = 54;

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
	${baseStyles}

	.layout { position: relative; height: 100%; padding: 64px 72px; display: flex; flex-direction: column; }
	.content { margin-top: auto; max-width: 940px; }
	.title { margin-top: 22px; font-size: ${titleSize}px; font-weight: 700; line-height: 1.06; letter-spacing: -0.03em; }
	.description {
		margin-top: 24px;
		font-size: 29px;
		line-height: 1.4;
		color: #a3a3a3;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.footer {
		margin-top: 44px;
		padding-top: 26px;
		border-top: 1px solid rgba(255, 255, 255, 0.12);
		font-family: "JetBrains Mono", monospace;
		font-size: 21px;
		color: #8a8a8a;
	}
</style>
</head>
<body>
	<div class="grid"></div>
	<div class="glow"></div>
	<div class="layout">
		<div class="brand"><img src="${logo}" alt="" />Zerobyte</div>
		<div class="content">
			<div class="eyebrow">${escapeHtml(card.eyebrow)}</div>
			<div class="title">${escapeHtml(card.title)}</div>
			<div class="description">${escapeHtml(card.description)}</div>
			<div class="footer">zerobyte.app${escapeHtml(card.path)}</div>
		</div>
	</div>
</body>
</html>`;
};

const buildHomeCardHtml = (baseStyles: string, logo: string, screenshot: string) => {
	const scale = HOME_SCREENSHOT_WIDTH / HERO_WINDOW.width;

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
	${baseStyles}

	.glow { right: -120px; bottom: -380px; width: 1300px; }
	.layout { position: relative; height: 100%; padding: 60px 72px 0; }
	.title { margin-top: 44px; font-size: 61px; font-weight: 700; line-height: 1.04; letter-spacing: -0.035em; white-space: nowrap; }
	.tagline { margin-top: 18px; font-size: 27px; color: #a3a3a3; }
	.screenshot {
		position: absolute;
		left: 72px;
		top: 318px;
		width: ${HOME_SCREENSHOT_WIDTH}px;
		height: ${HERO_WINDOW.height * scale}px;
		overflow: hidden;
		border-radius: ${HERO_WINDOW.radius * scale}px;
		box-shadow: 0 -20px 90px -20px rgba(255, 84, 58, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.08);
	}
	.screenshot img { display: block; width: auto; height: auto; zoom: ${scale}; margin: -${HERO_WINDOW.inset}px; }
</style>
</head>
<body>
	<div class="grid"></div>
	<div class="glow"></div>
	<div class="layout">
		<div class="brand"><img src="${logo}" alt="" />Zerobyte</div>
		<div class="title">Backups you can finally <span class="accent">forget about</span></div>
		<div class="tagline">Open source backup automation for Restic.</div>
	</div>
	<div class="screenshot"><img src="${screenshot}" alt="" /></div>
</body>
</html>`;
};

const renderCard = async (page: Page, html: string, path: string) => {
	await page.setContent(html, { waitUntil: "load" });
	await page.evaluate(() => document.fonts.ready);

	const name = path === "/" ? "home" : path.slice(1);
	const outputPath = join(OUTPUT_DIR, `${name}.jpg`);

	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY }));
};

const main = async () => {
	const baseStyles = buildBaseStyles({
		sans: await toDataUrl(join(FONTS_DIR, "geist/files/geist-latin-wght-normal.woff2"), "font/woff2"),
		mono: await toDataUrl(
			join(FONTS_DIR, "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"),
			"font/woff2",
		),
	});
	const logo = await toDataUrl(LOGO_PATH, "image/png");
	const screenshot = await toDataUrl(HERO_SCREENSHOT, "image/webp");

	const cards = [...staticCards, ...(await readDocsCards())];

	// Images of removed pages would otherwise keep shipping with the website.
	await rm(OUTPUT_DIR, { recursive: true, force: true });

	const browser = await chromium.launch();

	try {
		const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

		await renderCard(page, buildHomeCardHtml(baseStyles, logo, screenshot), "/");
		for (const card of cards) {
			await renderCard(page, buildPageCardHtml(card, baseStyles, logo), card.path);
		}
	} finally {
		await browser.close();
	}

	console.info(`Generated ${cards.length + 1} Open Graph images in ${relative(ROOT_DIR, OUTPUT_DIR)}`);
};

await main();
