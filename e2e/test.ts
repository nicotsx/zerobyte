import { expect, test as base } from "@playwright/test";
import { trackBrowserErrors } from "./helpers/browser-errors";

export const test = base.extend({
	context: async ({ context }, use, testInfo) => {
		const browserErrorTracker = trackBrowserErrors(context, {
			attach: async (name, body, contentType) => {
				await testInfo.attach(name, { body, contentType });
			},
		});

		await use(context);

		await browserErrorTracker.assertNoBrowserErrors();
	},
});

export { expect };
