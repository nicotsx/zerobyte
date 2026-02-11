import { readFileSync } from "node:fs";
import os from "node:os";
import { type } from "arktype";
import "dotenv/config";

const getResticHostname = () => {
	try {
		const mountinfo = readFileSync("/proc/self/mountinfo", "utf-8");
		const hostnameLine = mountinfo.split("\n").find((line) => line.includes(" /etc/hostname "));
		const hostname = os.hostname();

		if (hostnameLine) {
			const containerIdMatch = hostnameLine.match(/[0-9a-f]{64}/);
			const containerId = containerIdMatch ? containerIdMatch[0] : null;

			if (containerId?.startsWith(hostname)) {
				return "zerobyte";
			}

			return hostname || "zerobyte";
		}
	} catch {}

	return "zerobyte";
};

const envSchema = type({
	NODE_ENV: type.enumerated("development", "production", "test").default("production"),
	SERVER_IP: 'string = "localhost"',
	SERVER_IDLE_TIMEOUT: 'string.integer.parse = "60"',
	RESTIC_HOSTNAME: "string?",
	PORT: 'string.integer.parse = "4096"',
	MIGRATIONS_PATH: "string?",
	APP_VERSION: "string = 'dev'",
	TRUSTED_ORIGINS: "string?",
	DISABLE_RATE_LIMITING: 'string = "false"',
	APP_SECRET: "32 <= string <= 256",
	BASE_URL: "string",
	ENABLE_DEV_PANEL: 'string = "false"',
}).pipe((s) => ({
	__prod__: s.NODE_ENV === "production",
	environment: s.NODE_ENV,
	serverIp: s.SERVER_IP,
	serverIdleTimeout: s.SERVER_IDLE_TIMEOUT,
	resticHostname: s.RESTIC_HOSTNAME || getResticHostname(),
	port: s.PORT,
	migrationsPath: s.MIGRATIONS_PATH,
	appVersion: s.APP_VERSION,
	trustedOrigins: s.TRUSTED_ORIGINS?.split(",")
		.map((origin) => origin.trim())
		.concat(s.BASE_URL) ?? [s.BASE_URL],
	disableRateLimiting: s.DISABLE_RATE_LIMITING === "true",
	appSecret: s.APP_SECRET,
	baseUrl: s.BASE_URL,
	isSecure: s.BASE_URL?.startsWith("https://") ?? false,
	enableDevPanel: s.ENABLE_DEV_PANEL === "true",
}));

const parseConfig = (env: unknown) => {
	const result = envSchema(env);

	if (result instanceof type.errors) {
		if (!process.env.APP_SECRET) {
			const errorMessage = [
				"",
				"================================================================================",
				"APP_SECRET is not configured.",
				"",
				"This secret is required for encrypting sensitive data in the database.",
				"",
				"To generate a new secret, run:",
				"  openssl rand -hex 32",
				"",
				"Then set the APP_SECRET environment variable with the generated value.",
				"",
				"IMPORTANT: Store this secret securely and back it up. If lost, encrypted data",
				"in the database will be unrecoverable.",
				"================================================================================",
				"",
			].join("\n");

			console.error(errorMessage);
		}
		console.error(`Environment variable validation failed: ${result.summary}`);
		throw new Error("Invalid environment variables");
	}

	return result;
};

export const config = parseConfig(process.env);
