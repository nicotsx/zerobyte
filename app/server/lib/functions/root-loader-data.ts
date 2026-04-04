import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { THEME_COOKIE_NAME } from "~/client/components/theme-provider";
import type { DateFormatPreference, TimeFormatPreference } from "~/client/lib/datetime";
import { getLocaleFromAcceptLanguage } from "~/server/lib/accept-language";
import { auth } from "~/server/lib/auth";

export const getRootLoaderData = createServerFn({ method: "GET" }).handler(async () => {
	const themeCookie = getCookie(THEME_COOKIE_NAME);
	const headers = getRequestHeaders();
	const acceptLanguage = headers.get("accept-language");
	const session = await auth.api.getSession({ headers });

	return {
		theme: (themeCookie === "light" ? "light" : "dark") as "light" | "dark",
		locale: getLocaleFromAcceptLanguage(acceptLanguage),
		timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
		dateFormat: (session?.user.dateFormat ?? "MM/DD/YYYY") as DateFormatPreference,
		timeFormat: (session?.user.timeFormat ?? "12h") as TimeFormatPreference,
		now: Date.now(),
	};
});
