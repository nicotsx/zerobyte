import { useEffect, useMemo, useState } from "react";
import { useRootLoaderData } from "~/client/hooks/use-root-loader-data";
import { rawFormatters, type DateInput } from "~/lib/datetime";

export {
	DATE_FORMATS,
	DEFAULT_TIME_FORMAT,
	inferDateTimePreferences,
	rawFormatters,
	TIME_FORMATS,
} from "~/lib/datetime";
export type { DateFormatPreference, DateInput, TimeFormatPreference } from "~/lib/datetime";

export function useTimeFormat() {
	const { locale, timeZone, dateFormat, timeFormat, now } = useRootLoaderData();
	const [currentNow, setCurrentNow] = useState(now);

	useEffect(() => {
		const nextNow = Date.now();
		setCurrentNow(nextNow === now ? now : nextNow);
	}, [now]);

	return useMemo(
		() => ({
			formatDateTime: (date: DateInput) =>
				rawFormatters.formatDateTime(date, { locale, timeZone, dateFormat, timeFormat }),
			formatDateWithMonth: (date: DateInput) =>
				rawFormatters.formatDateWithMonth(date, {
					locale,
					timeZone,
					dateFormat,
					timeFormat,
				}),
			formatDate: (date: DateInput) =>
				rawFormatters.formatDate(date, { locale, timeZone, dateFormat, timeFormat }),
			formatShortDate: (date: DateInput) =>
				rawFormatters.formatShortDate(date, { locale, timeZone, dateFormat, timeFormat }),
			formatShortDateTime: (date: DateInput) =>
				rawFormatters.formatShortDateTime(date, {
					locale,
					timeZone,
					dateFormat,
					timeFormat,
				}),
			formatTime: (date: DateInput) =>
				rawFormatters.formatTime(date, { locale, timeZone, dateFormat, timeFormat }),
			formatTimeAgo: (date: DateInput) => rawFormatters.formatTimeAgo(date, currentNow),
		}),
		[locale, timeZone, currentNow, dateFormat, timeFormat],
	);
}
