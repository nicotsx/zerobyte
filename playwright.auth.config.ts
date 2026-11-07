import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: [
		"0005-two-factor.spec.ts",
		"0008-passkeys.spec.ts",
		"0009-password-auth.spec.ts",
		"0010-api-keys.spec.ts",
	],
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
