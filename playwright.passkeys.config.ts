import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/__tests__",
	testMatch: "passkeys.spec.ts",
	workers: 1,
	forbidOnly: !!process.env.CI,
	timeout: 60000,
	reporter: "list",
	use: {
		...devices["Desktop Chrome"],
		baseURL: process.env.E2E_BASE_URL,
		ignoreHTTPSErrors: true,
		trace: "retain-on-failure",
	},
});
