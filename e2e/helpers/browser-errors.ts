import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";

const IGNORED_PATTERNS: RegExp[] = [
	/^\[APP\]/,
	/Failed to load resource: the server responded with a status of 4\d{2}/,
];

const isIgnoredError = (text: string) => IGNORED_PATTERNS.some((pattern) => pattern.test(text));

const isAbortedFetchConsoleError = (record: BrowserErrorRecord, records: BrowserErrorRecord[]) => {
	if (record.type !== "console.error" || !record.message.includes("TypeError: Failed to fetch")) {
		return false;
	}

	const recordTimestamp = Date.parse(record.timestamp);

	return records.some((candidate) => {
		if (candidate.type !== "requestfailed" || candidate.pageId !== record.pageId) {
			return false;
		}

		if (!candidate.message.includes("net::ERR_ABORTED")) {
			return false;
		}

		return Math.abs(Date.parse(candidate.timestamp) - recordTimestamp) <= 1000;
	});
};

const formatConsoleMessage = (message: ConsoleMessage) => {
	const location = message.location();
	const hasLocation = !!location.url;
	const formattedLocation = hasLocation
		? ` (${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1})`
		: "";

	return `console.error${formattedLocation}\n${message.text()}`;
};

type BrowserErrorRecord = {
	type: "console.error" | "pageerror" | "requestfailed";
	pageId: string;
	pageUrl: string;
	timestamp: string;
	message: string;
};

type FirstPageErrorSnapshot = {
	pageId: string;
	pageUrl: string;
	timestamp: string;
	title: string;
	html: string;
	clientLocale: string;
	clientLanguages: string[];
	clientTimeZone: string;
	appReady: string | null;
};

type TrackBrowserErrorsOptions = {
	attach?: (name: string, body: string | Buffer, contentType: string) => Promise<void>;
};

const formatBrowserErrorRecord = (record: BrowserErrorRecord) => {
	return `[${record.timestamp}] ${record.type} on ${record.pageId} (${record.pageUrl})\n${record.message}`;
};

async function captureFirstPageErrorSnapshot(
	page: Page,
	pageId: string,
): Promise<{
	screenshot: Buffer;
	snapshot: FirstPageErrorSnapshot;
}> {
	const timestamp = new Date().toISOString();
	const pageUrl = page.url();
	const screenshot = await page.screenshot({ fullPage: true, type: "png" });
	const snapshot = await page.evaluate(
		({ currentPageId, currentTimestamp }) => ({
			pageId: currentPageId,
			pageUrl: window.location.href,
			timestamp: currentTimestamp,
			title: document.title,
			html: document.documentElement.outerHTML,
			clientLocale: navigator.language,
			clientLanguages: [...navigator.languages],
			clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			appReady: document.body?.getAttribute("data-app-ready") ?? null,
		}),
		{ currentPageId: pageId, currentTimestamp: timestamp },
	);

	return {
		screenshot,
		snapshot: {
			...snapshot,
			pageUrl: snapshot.pageUrl || pageUrl,
		},
	};
}

export const trackBrowserErrors = (context: BrowserContext, options: TrackBrowserErrorsOptions = {}) => {
	const browserErrors: BrowserErrorRecord[] = [];
	const trackedPages = new WeakSet<Page>();
	const pageIds = new WeakMap<Page, string>();
	let nextPageId = 1;
	let firstPageErrorSnapshotPromise: Promise<Awaited<ReturnType<typeof captureFirstPageErrorSnapshot>>> | undefined;

	void context.addInitScript(() => {
		window.addEventListener("unhandledrejection", (event) => {
			const reason =
				event.reason instanceof Error
					? (event.reason.stack ?? event.reason.message)
					: typeof event.reason === "string"
						? event.reason
						: JSON.stringify(event.reason);

			console.error(`[unhandledrejection]\n${reason}`);
		});
	});

	const getPageId = (page: Page) => {
		const existingPageId = pageIds.get(page);
		if (existingPageId) {
			return existingPageId;
		}

		const pageId = `page-${nextPageId++}`;
		pageIds.set(page, pageId);
		return pageId;
	};

	const pushRecord = (page: Page, type: BrowserErrorRecord["type"], message: string) => {
		browserErrors.push({
			type,
			pageId: getPageId(page),
			pageUrl: page.url(),
			timestamp: new Date().toISOString(),
			message,
		});
	};

	const trackPage = (page: Page) => {
		if (trackedPages.has(page)) {
			return;
		}

		trackedPages.add(page);
		getPageId(page);

		page.on("console", (message) => {
			if (message.type() !== "error") {
				return;
			}

			if (isIgnoredError(message.text())) {
				return;
			}

			pushRecord(page, "console.error", formatConsoleMessage(message));
		});

		page.on("pageerror", (error) => {
			pushRecord(page, "pageerror", error.stack ?? error.message);

			if (!firstPageErrorSnapshotPromise && !page.isClosed()) {
				firstPageErrorSnapshotPromise = captureFirstPageErrorSnapshot(page, getPageId(page));
			}
		});

		page.on("requestfailed", (request) => {
			const failure = request.failure();
			if (!failure) {
				return;
			}

			pushRecord(page, "requestfailed", `${request.method()} ${request.url()}\n${failure.errorText}`);
		});
	};

	for (const page of context.pages()) {
		trackPage(page);
	}

	context.on("page", trackPage);

	return {
		async assertNoBrowserErrors() {
			const failingBrowserErrors = browserErrors.filter((record) => {
				if (record.type === "requestfailed") {
					return false;
				}

				return !isAbortedFetchConsoleError(record, browserErrors);
			});

			if (failingBrowserErrors.length === 0) {
				return;
			}

			if (options.attach) {
				await options.attach(
					"browser-errors.md",
					[
						"# Browser error diagnostics",
						"",
						...browserErrors.flatMap((record) => [formatBrowserErrorRecord(record), ""]),
					].join("\n"),
					"text/markdown",
				);
				await options.attach(
					"browser-errors.json",
					JSON.stringify(
						{
							records: browserErrors,
							firstPageErrorSnapshot: null,
						},
						null,
						2,
					),
					"application/json",
				);
			}

			const firstPageErrorSnapshot = firstPageErrorSnapshotPromise ? await firstPageErrorSnapshotPromise : undefined;

			if (options.attach && firstPageErrorSnapshot) {
				await options.attach(
					"browser-errors.json",
					JSON.stringify(
						{
							records: browserErrors,
							firstPageErrorSnapshot: firstPageErrorSnapshot.snapshot,
						},
						null,
						2,
					),
					"application/json",
				);
				await options.attach("first-pageerror.png", firstPageErrorSnapshot.screenshot, "image/png");
				await options.attach("first-pageerror.html", firstPageErrorSnapshot.snapshot.html, "text/html");
			}

			throw new Error(
				`Browser console errors detected:\n\n${failingBrowserErrors.map(formatBrowserErrorRecord).join("\n\n")}`,
			);
		},
	};
};
