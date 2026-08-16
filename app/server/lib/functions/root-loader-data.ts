import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { DateFormatPreference, TimeFormatPreference } from "~/lib/datetime";
import { getLocaleFromAcceptLanguage } from "~/server/lib/accept-language";
import { auth } from "~/server/lib/auth";

export const getRootLoaderData = createServerFn({ method: "GET" }).handler(async () => {
	const headers = getRequestHeaders();
	const acceptLanguage = headers.get("accept-language");
	const session = await auth.api.getSession({ headers });

	return {
		locale: getLocaleFromAcceptLanguage(acceptLanguage),
		timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
		dateFormat: (session?.user.dateFormat ?? "MM/DD/YYYY") as DateFormatPreference,
		timeFormat: (session?.user.timeFormat ?? "12h") as TimeFormatPreference,
		now: Date.now(),
	};
});
