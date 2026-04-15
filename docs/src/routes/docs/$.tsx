import { createFileRoute, notFound } from "@tanstack/react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { createServerFn } from "@tanstack/react-start";
import { source } from "@/lib/source";
import browserCollections from "fumadocs-mdx:collections/browser";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Accordion, Accordions } from "fumadocs-ui/components/accordion";
import { Step, Steps } from "fumadocs-ui/components/steps";
import { baseOptions } from "@/lib/layout.shared";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { Suspense } from "react";
import { Card, Cards } from "@/components/DocsCard";

export const Route = createFileRoute("/docs/$")({
	component: Page,
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		const data = await serverLoader({ data: slugs });
		await clientLoader.preload(data.path);
		return data;
	},
});

const serverLoader = createServerFn({
	method: "GET",
})
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }) => {
		const page = source.getPage(slugs);
		if (!page) throw notFound();
		return {
			path: page.path,
			pageTree: await source.serializePageTree(source.getPageTree()),
		};
	});
const clientLoader = browserCollections.docs.createClientLoader({
	component(
		{ toc, frontmatter, default: MDX },
		// you can define props for the component
		_props: undefined,
	) {
		return (
			<DocsPage
				toc={toc}
				tableOfContent={{
					style: "clerk",
				}}
			>
				<div className="">
					<header className="docs-hero">
						<DocsTitle className="font-extrabold">{frontmatter.title}</DocsTitle>
						<div className="docs-description">
							<DocsDescription>{frontmatter.description}</DocsDescription>
						</div>
					</header>
					<div className="docs-prose-wrap">
						<DocsBody>
							<MDX
								components={{
									...defaultMdxComponents,
									Accordion,
									Accordions,
									Card,
									Cards,
									Step,
									Steps,
								}}
							/>
						</DocsBody>
					</div>
				</div>
			</DocsPage>
		);
	},
});
function Page() {
	const data = useFumadocsLoader(Route.useLoaderData());
	return (
		<div data-docs-page className="relative">
			<div aria-hidden className="landing-hero-docs-grid pointer-events-none absolute inset-0" />
			<div className="relative">
				<DocsLayout {...baseOptions()} tree={data.pageTree}>
					<Suspense>{clientLoader.useContent(data.path)}</Suspense>
				</DocsLayout>
			</div>
		</div>
	);
}
