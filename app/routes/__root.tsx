import { Outlet, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import appCss from "../app.css?url";
import { authMiddleware } from "~/middleware/auth";

export const Route = createRootRoute({
	server: {
		middleware: [authMiddleware],
	},
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "TanStack Start Starter" },
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
			{ rel: "preconnect", href: "https://fonts.googleapis.com" },
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Google+Sans+Code:ital,wght@0,300..800;1,300..800&display=swap",
			},
		],
	}),
	component: RootLayout,
});

function RootLayout() {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
				<link rel="icon" type="image/png" href="/images/favicon/favicon-96x96.png" sizes="96x96" />
				<link rel="icon" type="image/svg+xml" href="/images/favicon/favicon.svg" />
				<link rel="shortcut icon" href="/images/favicon/favicon.ico" />
				<link rel="apple-touch-icon" sizes="180x180" href="/images/favicon/apple-touch-icon.png" />
				<meta name="apple-mobile-web-app-title" content="Zerobyte" />
				<link rel="manifest" href="/images/favicon/site.webmanifest" />
				<HeadContent />
			</head>
			<body className="dark">
				<Outlet />
				<Scripts />
			</body>
		</html>
	);
}
