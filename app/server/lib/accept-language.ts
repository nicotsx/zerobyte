const DEFAULT_LOCALE = "en-US";

export function getLocaleFromAcceptLanguage(acceptLanguage?: string | null) {
	if (!acceptLanguage) {
		return DEFAULT_LOCALE;
	}

	for (const value of acceptLanguage.split(",")) {
		const languageTag = value.split(";")[0]?.trim();

		if (!languageTag) {
			continue;
		}

		try {
			Intl.getCanonicalLocales(languageTag);
			return languageTag;
		} catch {
			continue;
		}
	}

	return DEFAULT_LOCALE;
}
