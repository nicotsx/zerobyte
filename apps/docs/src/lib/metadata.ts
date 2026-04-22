import ogImageAssetUrl from "@/assets/og.jpg";

export const siteUrl = "https://zerobyte.app";
export const siteTitle = "Zerobyte | Backup automation for Restic";
export const siteDescription =
	"Zerobyte is a web control plane for Restic backups with scheduling, encrypted repositories, monitoring, and restore workflows.";
export const ogImageUrl = new URL(ogImageAssetUrl, siteUrl).toString();

function getCanonicalUrl(path: string) {
	return new URL(path, siteUrl).toString();
}

export function buildSeoHead({ title, description, path }: { title: string; description: string; path: string }) {
	const canonicalUrl = getCanonicalUrl(path);

	return {
		meta: [
			{ title },
			{ name: "description", content: description },
			{ property: "og:title", content: title },
			{ property: "og:description", content: description },
			{ property: "og:url", content: canonicalUrl },
			{ name: "twitter:title", content: title },
			{ name: "twitter:description", content: description },
		],
		links: [{ rel: "canonical", href: canonicalUrl }],
	};
}

export function formatDocsTitle(title: string) {
	if (title.toLowerCase().includes("zerobyte")) return title;

	return `${title} | Zerobyte Docs`;
}
