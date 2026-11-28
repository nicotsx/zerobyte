import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import Header from "../components/Header";
import { siteName } from "@/lib/metadata";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				property: "og:site_name",
				content: siteName,
			},
			{
				property: "og:locale",
				content: "en_US",
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{ rel: "icon", type: "image/png", href: "/images/favicon/favicon-96x96.png", sizes: "96x96" },
			{ rel: "icon", type: "image/svg+xml", href: "/images/favicon/favicon.svg" },
			{ rel: "shortcut icon", href: "/images/favicon/favicon.ico" },
			{ rel: "apple-touch-icon", sizes: "180x180", href: "/images/favicon/apple-touch-icon.png" },
			{ rel: "manifest", href: "/images/favicon/site.webmanifest" },
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="dark" className="dark">
			<head>
				<script defer data-domain="zerobyte.app" src="https://assets.foreach.li/js/script.js"></script>
				<HeadContent />
			</head>
			<body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-strong-accent/24">
				<Header />
				<RootProvider theme={{ defaultTheme: "dark", enabled: false }}>{children}</RootProvider>
				<Scripts />
			</body>
		</html>
	);
}
