export const DATE_FORMATS = ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"] as const;
export type DateFormatPreference = (typeof DATE_FORMATS)[number];
const DEFAULT_DATE_FORMAT: DateFormatPreference = "MM/DD/YYYY";

export const TIME_FORMATS = ["12h", "24h"] as const;
export type TimeFormatPreference = (typeof TIME_FORMATS)[number];
export const DEFAULT_TIME_FORMAT: TimeFormatPreference = "12h";

const BROWSER_PREFERENCE_SAMPLE_DATE = new Date(Date.UTC(2006, 0, 2, 15, 4, 5));

export function inferDateTimePreferences(locale?: string) {
	const dateOrder = Intl.DateTimeFormat(locale, {
		month: "numeric",
		day: "numeric",
		year: "numeric",
	})
		.formatToParts(BROWSER_PREFERENCE_SAMPLE_DATE)
		.flatMap((part) => {
			if (part.type === "year" || part.type === "month" || part.type === "day") {
				return [part.type];
			}

			return [];
		})
		.join("/");

	let dateFormat = DEFAULT_DATE_FORMAT;

	if (dateOrder === "day/month/year") {
		dateFormat = "DD/MM/YYYY";
	} else if (dateOrder === "year/month/day") {
		dateFormat = "YYYY/MM/DD";
	}

	let timeFormat: TimeFormatPreference = "12h";
	const hour12 = Intl.DateTimeFormat(locale, { hour: "numeric" }).resolvedOptions().hour12;

	if (hour12 === false) {
		timeFormat = "24h";
	}

	return {
		dateFormat,
		timeFormat,
	};
}
