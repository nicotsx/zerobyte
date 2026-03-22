import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";

const IGNORED_PATTERNS: RegExp[] = [
	/^\[APP\]/,
	/Failed to load resource: the server responded with a status of 4\d{2}/,
];

const isIgnoredError = (text: string) => IGNORED_PATTERNS.some((pattern) => pattern.test(text));

const formatConsoleMessage = (message: ConsoleMessage) => {
	const location = message.location();
	const hasLocation = !!location.url;
	const formattedLocation = hasLocation
		? ` (${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1})`
		: "";

	return `console.error${formattedLocation}\n${message.text()}`;
};

export const trackBrowserErrors = (context: BrowserContext) => {
	const browserErrors: string[] = [];
	const trackedPages = new WeakSet<Page>();

	const trackPage = (page: Page) => {
		if (trackedPages.has(page)) {
			return;
		}

		trackedPages.add(page);

		page.on("console", (message) => {
			if (message.type() !== "error") {
				return;
			}

			if (isIgnoredError(message.text())) {
				return;
			}

			browserErrors.push(formatConsoleMessage(message));
		});

		page.on("pageerror", (error) => {
			browserErrors.push(`pageerror\n${error.stack ?? error.message}`);
		});
	};

	for (const page of context.pages()) {
		trackPage(page);
	}

	context.on("page", trackPage);

	return {
		assertNoBrowserErrors() {
			if (browserErrors.length === 0) {
				return;
			}

			throw new Error(`Browser console errors detected:\n\n${browserErrors.join("\n\n")}`);
		},
	};
};
