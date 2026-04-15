import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { RootProvider } from "fumadocs-ui/provider/tanstack";

import Header from "../components/Header";

import appCss from "../styles.css?url";

const siteUrl = "https://zerobyte.app";
const ogImageUrl = `${siteUrl}/images/og.png`;

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
				title: "Zerobyte | Backup automation for Restic",
			},
			{
				name: "description",
				content:
					"Zerobyte is a web control plane for Restic backups with scheduling, encrypted repositories, monitoring, and restore workflows.",
			},
			{
				property: "og:title",
				content: "Zerobyte | Backup automation for Restic",
			},
			{
				property: "og:description",
				content:
					"Zerobyte is a web control plane for Restic backups with scheduling, encrypted repositories, monitoring, and restore workflows.",
			},
			{
				property: "og:type",
				content: "website",
			},
			{
				property: "og:url",
				content: siteUrl,
			},
			{
				property: "og:image",
				content: ogImageUrl,
			},
			{
				property: "og:image:width",
				content: "2048",
			},
			{
				property: "og:image:height",
				content: "1152",
			},
			{
				property: "og:image:alt",
				content: "Zerobyte backups dashboard preview",
			},
			{
				name: "twitter:card",
				content: "summary_large_image",
			},
			{
				name: "twitter:title",
				content: "Zerobyte | Backup automation for Restic",
			},
			{
				name: "twitter:description",
				content:
					"Zerobyte is a web control plane for Restic backups with scheduling, encrypted repositories, monitoring, and restore workflows.",
			},
			{
				name: "twitter:image",
				content: ogImageUrl,
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
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap",
			},
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
