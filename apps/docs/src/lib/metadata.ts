import { faqs } from "@/lib/faqs";

export const siteUrl = "https://zerobyte.app";
export const siteName = "Zerobyte";
export const siteTitle = "Zerobyte | Backup automation for Restic";
export const siteDescription =
	"Zerobyte is a web control plane for Restic backups with scheduling, encrypted repositories, monitoring, and restore workflows.";
export const repoUrl = "https://github.com/nicotsx/zerobyte";

const OG_IMAGE_WIDTH = 1200;
const OG_IMAGE_HEIGHT = 630;
const FALLBACK_OG_IMAGE = "home";

// Generated before every build by scripts/generate-og-images.ts, one image per page. They are missing in dev until a build has run.
const ogImageAssets = import.meta.glob<string>("../assets/og/**/*.jpg", {
	eager: true,
	query: "?url",
	import: "default",
});

function toAbsoluteUrl(path: string) {
	return new URL(path, siteUrl).toString();
}

function getOgImageUrl(path: string) {
	const name = path === "/" ? FALLBACK_OG_IMAGE : path.replace(/^\/|\/$/g, "");
	const asset = ogImageAssets[`../assets/og/${name}.jpg`] ?? ogImageAssets[`../assets/og/${FALLBACK_OG_IMAGE}.jpg`];
	if (!asset) return undefined;

	return toAbsoluteUrl(asset);
}

type JsonLd = Record<string, unknown>;

// The JSON is inlined in a script tag, where an unescaped "<" could close the tag early.
function serializeJsonLd(data: JsonLd) {
	return JSON.stringify(data).replaceAll("<", "\\u003c");
}

type SeoHeadOptions = {
	title: string;
	description: string;
	path: string;
	type?: "website" | "article";
	jsonLd?: JsonLd[];
};

export function buildSeoHead({ title, description, path, type = "website", jsonLd = [] }: SeoHeadOptions) {
	const canonicalUrl = toAbsoluteUrl(path);
	const imageUrl = getOgImageUrl(path);

	const imageMeta = imageUrl
		? [
				{ property: "og:image", content: imageUrl },
				{ property: "og:image:type", content: "image/jpeg" },
				{ property: "og:image:width", content: String(OG_IMAGE_WIDTH) },
				{ property: "og:image:height", content: String(OG_IMAGE_HEIGHT) },
				{ property: "og:image:alt", content: title },
				{ name: "twitter:image", content: imageUrl },
				{ name: "twitter:image:alt", content: title },
			]
		: [];

	return {
		meta: [
			{ title },
			{ name: "description", content: description },
			{ property: "og:type", content: type },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
			...imageMeta,
		],
		links: [{ rel: "canonical", href: canonicalUrl }],
		scripts: jsonLd.map((data) => ({ type: "application/ld+json", children: serializeJsonLd(data) })),
	};
}

export function formatDocsTitle(title: string) {
	if (title.toLowerCase().includes("zerobyte")) return title;

	return `${title} | Zerobyte Docs`;
}

export function buildHomeJsonLd(): JsonLd[] {
	return [
		{
			"@context": "https://schema.org",
			"@type": "WebSite",
			name: siteName,
			url: siteUrl,
		},
		{
			"@context": "https://schema.org",
			"@type": "SoftwareApplication",
			name: siteName,
			description: siteDescription,
			url: siteUrl,
			image: getOgImageUrl("/"),
			applicationCategory: "UtilitiesApplication",
			operatingSystem: "Linux, Docker",
			license: "https://www.gnu.org/licenses/agpl-3.0.html",
			codeRepository: repoUrl,
			offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
		},
		{
			"@context": "https://schema.org",
			"@type": "FAQPage",
			mainEntity: faqs.map((faq) => ({
				"@type": "Question",
				name: faq.question,
				acceptedAnswer: { "@type": "Answer", text: faq.answer },
			})),
		},
	];
}

export function buildDocsJsonLd({
	title,
	description,
	path,
}: {
	title: string;
	description: string;
	path: string;
}): JsonLd[] {
	const url = toAbsoluteUrl(path);

	const breadcrumbs = [
		{ name: siteName, url: siteUrl },
		{ name: "Documentation", url: toAbsoluteUrl("/docs") },
	];
	if (path !== "/docs") breadcrumbs.push({ name: title, url });

	return [
		{
			"@context": "https://schema.org",
			"@type": "TechArticle",
			headline: title,
			description,
			url,
			image: getOgImageUrl(path),
			author: { "@type": "Organization", name: siteName, url: siteUrl },
			publisher: { "@type": "Organization", name: siteName, url: siteUrl },
		},
		{
			"@context": "https://schema.org",
			"@type": "BreadcrumbList",
			itemListElement: breadcrumbs.map((breadcrumb, index) => ({
				"@type": "ListItem",
				position: index + 1,
				name: breadcrumb.name,
				item: breadcrumb.url,
			})),
		},
	];
}
