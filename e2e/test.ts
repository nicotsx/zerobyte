import { expect, test as base } from "@playwright/test";
import { trackBrowserErrors } from "./helpers/browser-errors";

export const test = base.extend({
	context: async ({ context }, use) => {
		const browserErrorTracker = trackBrowserErrors(context);

		await use(context);

		browserErrorTracker.assertNoBrowserErrors();
	},
});

export { expect };
