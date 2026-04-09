import { afterEach, describe, expect, test, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { parseConfig } from "../config";

const validAppSecret = "a".repeat(32);
const fileAppSecret = "b".repeat(32);
const appSecretFixturePath = fileURLToPath(new URL("./fixtures/app-secret.txt", import.meta.url));
const shortAppSecretFixturePath = fileURLToPath(new URL("./fixtures/short-app-secret.txt", import.meta.url));

const createEnv = (overrides: Record<string, string | undefined> = {}) => {
	const env = {
		APP_SECRET: validAppSecret,
		BASE_URL: "http://example.com",
		RESTIC_HOSTNAME: "configured-restic-host",
		...overrides,
	};

	return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
};

const expectParseConfigToExit = (env: Record<string, string | undefined>, message: string) => {
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	const exitSpy = vi.spyOn(process, "exit").mockImplementation((code: string | number | null | undefined) => {
		throw new Error(`process.exit:${code}`);
	});

	expect(() => parseConfig(env)).toThrow("process.exit:1");
	expect(exitSpy).toHaveBeenCalledWith(1);
	expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(message));
};

describe("parseConfig", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("parses quoted origins and derives runtime flags", () => {
		const config = parseConfig(
			createEnv({
				NODE_ENV: "development",
				BASE_URL: '"https://example.com"',
				TRUSTED_ORIGINS: '"https://admin.example.com", "http://localhost:3000"',
				TRUST_PROXY: "true",
				DISABLE_RATE_LIMITING: "true",
				ENABLE_DEV_PANEL: "true",
				SERVER_IP: "0.0.0.0",
				SERVER_IDLE_TIMEOUT: "120",
				PORT: "8080",
				APP_VERSION: "1.2.3",
				MIGRATIONS_PATH: "/tmp/migrations",
				PROVISIONING_PATH: "/tmp/provisioning",
			}),
		);

		expect(config).toEqual({
			__prod__: false,
			environment: "development",
			serverIp: "0.0.0.0",
			serverIdleTimeout: 120,
			resticHostname: "configured-restic-host",
			port: 8080,
			migrationsPath: "/tmp/migrations",
			appVersion: "1.2.3",
			trustedOrigins: ["https://admin.example.com", "http://localhost:3000", "https://example.com"],
			trustProxy: true,
			disableRateLimiting: true,
			appSecret: validAppSecret,
			baseUrl: "https://example.com",
			isSecure: true,
			enableDevPanel: true,
			provisioningPath: "/tmp/provisioning",
			allowedHosts: ["example.com", "admin.example.com", "localhost:3000"],
		});
	});

	test("uses the configured RESTIC_HOSTNAME when present", () => {
		const config = parseConfig(
			createEnv({
				RESTIC_HOSTNAME: "manual-restic-host",
			}),
		);

		expect(config.resticHostname).toBe("manual-restic-host");
	});

	test("reads APP_SECRET from APP_SECRET_FILE", () => {
		const config = parseConfig(
			createEnv({
				APP_SECRET: undefined,
				APP_SECRET_FILE: appSecretFixturePath,
			}),
		);

		expect(config.appSecret).toBe(fileAppSecret);
	});

	test("exits when APP_SECRET is missing", () => {
		expectParseConfigToExit(
			createEnv({
				APP_SECRET: undefined,
			}),
			"APP_SECRET is not configured.",
		);
	});

	test("exits when both APP_SECRET and APP_SECRET_FILE are set", () => {
		expectParseConfigToExit(
			createEnv({
				APP_SECRET_FILE: "/run/secrets/app-secret",
			}),
			"Both APP_SECRET and APP_SECRET_FILE are set. Please set only one of these.",
		);
	});

	test("exits when APP_SECRET_FILE cannot be read", () => {
		expectParseConfigToExit(
			createEnv({
				APP_SECRET: undefined,
				APP_SECRET_FILE: "/path/that/does/not/exist",
			}),
			"Failed to read APP_SECRET from file:",
		);
	});

	test("exits when APP_SECRET_FILE contains a secret with an invalid length", () => {
		expectParseConfigToExit(
			createEnv({
				APP_SECRET: undefined,
				APP_SECRET_FILE: shortAppSecretFixturePath,
			}),
			"The secret read from APP_SECRET_FILE must be between 32 and 256 characters long.",
		);
	});

	test("exits when no valid trusted origins are provided", () => {
		expectParseConfigToExit(
			createEnv({
				BASE_URL: "notaurl",
			}),
			"No valid trusted origins provided. Please check the BASE_URL and TRUSTED_ORIGINS environment variables.",
		);
	});
});
