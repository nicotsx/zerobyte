import { createFileRoute } from "@tanstack/react-router";

import { siteUrl } from "@/lib/metadata";
import { source } from "@/lib/source";

function escapeXml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function buildSitemapXml(urls: string[]) {
	const entries = urls.map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`).join("\n");

	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`;
}

export const Route = createFileRoute("/sitemap.xml")({
	server: {
		handlers: {
			GET: async () => {
				const urls = Array.from(new Set(["/", "/privacy", ...source.getPages().map((page) => page.url)]))
					.sort()
					.map((path) => new URL(path, siteUrl).toString());

				return new Response(buildSitemapXml(urls), {
					headers: {
						"Content-Type": "application/xml; charset=utf-8",
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
});
