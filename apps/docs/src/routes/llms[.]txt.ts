import { createFileRoute } from "@tanstack/react-router";

import { repoUrl, siteDescription, siteName, siteUrl } from "@/lib/metadata";
import { source } from "@/lib/source";

const sectionTitles: Record<string, string> = {
	concepts: "Concepts",
	guides: "Guides",
};

function buildLlmsTxt() {
	const sections = new Map<string, string[]>();

	for (const page of source.getPages()) {
		const section = sectionTitles[page.slugs[0]] ?? "Documentation";
		const url = new URL(page.url, siteUrl).toString();
		const summary = page.data.description ? `: ${page.data.description}` : "";

		const entries = sections.get(section) ?? [];
		entries.push(`- [${page.data.title}](${url})${summary}`);
		sections.set(section, entries);
	}

	const body = Array.from(sections, ([title, entries]) => `## ${title}\n\n${entries.join("\n")}`).join("\n\n");

	return `# ${siteName}\n\n> ${siteDescription}\n\nSource code: ${repoUrl}\n\n${body}\n`;
}

export const Route = createFileRoute("/llms.txt")({
	server: {
		handlers: {
			GET: async () => {
				return new Response(buildLlmsTxt(), {
					headers: {
						"Content-Type": "text/plain; charset=utf-8",
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
});
