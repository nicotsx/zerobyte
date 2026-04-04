const DEFAULT_LOCALE = "en-US";

export function getLocaleFromAcceptLanguage(acceptLanguage?: string | null) {
	if (!acceptLanguage) {
		return DEFAULT_LOCALE;
	}

	let locale = DEFAULT_LOCALE;
	let highestQuality = -1;

	for (const value of acceptLanguage.split(",")) {
		const [rawLanguageTag, ...parameters] = value.split(";");
		const languageTag = rawLanguageTag?.trim();

		if (!languageTag) {
			continue;
		}

		let quality = 1;

		for (const parameter of parameters) {
			const [key, value] = parameter.split("=");

			if (key?.trim().toLowerCase() !== "q") {
				continue;
			}

			const parsedQuality = Number(value?.trim());

			if (!Number.isFinite(parsedQuality) || parsedQuality < 0 || parsedQuality > 1) {
				quality = -1;
				break;
			}

			quality = parsedQuality;
			break;
		}

		if (quality <= highestQuality) {
			continue;
		}

		try {
			locale = Intl.getCanonicalLocales(languageTag)[0] || DEFAULT_LOCALE;
			highestQuality = quality;
		} catch {
			continue;
		}
	}

	return locale;
}
