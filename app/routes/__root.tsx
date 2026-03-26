import { Outlet, HeadContent, Scripts, createRootRouteWithContext, useRouterState } from "@tanstack/react-router";
import appCss from "../app.css?url";
import { apiClientMiddleware } from "~/middleware/api-client";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "~/client/components/ui/sonner";
import { useServerEvents } from "~/client/hooks/use-server-events";
import { useEffect } from "react";
import { ThemeProvider, THEME_COOKIE_NAME } from "~/client/components/theme-provider";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { isAuthRoute } from "~/lib/auth-routes";
import { auth } from "~/server/lib/auth";
import type { DateFormatPreference, TimeFormatPreference } from "~/client/lib/datetime";

const fetchTheme = createServerFn({ method: "GET" }).handler(async () => {
	const themeCookie = getCookie(THEME_COOKIE_NAME);
	return (themeCookie === "light" ? "light" : "dark") as "light" | "dark";
});

const fetchTimeConfig = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const acceptLanguage = headers.get("accept-language");
	const session = await auth.api.getSession({ headers });

	return {
		locale: (acceptLanguage?.split(",")[0] || "en-US") as string,
		timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
		dateFormat: (session?.user.dateFormat ?? "MM/DD/YYYY") as DateFormatPreference,
		timeFormat: (session?.user.timeFormat ?? "12h") as TimeFormatPreference,
		now: Date.now(),
	};
});

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	server: {
		middleware: [apiClientMiddleware],
	},
	loader: async () => {
		const [theme, timeConfig] = await Promise.all([fetchTheme(), fetchTimeConfig()]);
		return { theme, ...timeConfig };
	},
	head: () => ({
		meta: [{ title: "Zerobyte - Open Source Backup Solution" }],
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
	errorComponent: (e) => <div>{e.error.message}</div>,
});

export function RootLayout() {
	const { theme } = Route.useLoaderData();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	useServerEvents({ enabled: !isAuthRoute(pathname) });
	useEffect(() => {
		document.body.setAttribute("data-app-ready", "true");
		window.addEventListener("vite:preloadError", () => {
			window.location.reload();
		});

		return () => {
			document.body.removeAttribute("data-app-ready");
		};
	}, []);

	return (
		<html lang="en" className={theme === "dark" ? "dark" : undefined} style={{ colorScheme: theme }}>
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
			<body>
				<ThemeProvider initialTheme={theme}>
					<Outlet />
					<Toaster />
					<ReactQueryDevtools buttonPosition="bottom-right" />
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	);
}
