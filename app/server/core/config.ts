import { readFileSync } from "node:fs";
import os from "node:os";
import { z } from "zod";
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

const envSchema = z
	.object({
		NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
		SERVER_IP: z.string().default("localhost"),
		SERVER_IDLE_TIMEOUT: z.coerce.number().int().default(60),
		RESTIC_HOSTNAME: z.string().optional(),
		PORT: z.coerce.number().int().default(4096),
		MIGRATIONS_PATH: z.string().optional(),
		APP_VERSION: z.string().default("dev"),
		TRUSTED_ORIGINS: z.string().optional(),
		TRUST_PROXY: z.string().default("false"),
		DISABLE_RATE_LIMITING: z.string().default("false"),
		APP_SECRET: z.string().min(32).max(256),
		BASE_URL: z.string(),
		ENABLE_DEV_PANEL: z.string().default("false"),
		PROVISIONING_PATH: z.string().optional(),
	})
	.transform((s) => ({
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
			.filter(Boolean)
			.concat(s.BASE_URL) ?? [s.BASE_URL],
		trustProxy: s.TRUST_PROXY === "true",
		disableRateLimiting: s.DISABLE_RATE_LIMITING === "true",
		appSecret: s.APP_SECRET,
		baseUrl: s.BASE_URL,
		isSecure: s.BASE_URL?.startsWith("https://") ?? false,
		enableDevPanel: s.ENABLE_DEV_PANEL === "true",
		provisioningPath: s.PROVISIONING_PATH,
	}));

const parseConfig = (env: unknown) => {
	const result = envSchema.safeParse(env);

	if (!result.success) {
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

		console.error(`Environment variable validation failed: ${result.error.message}`);
		throw new Error("Invalid environment variables");
	}

	return result.data;
};

export const config = parseConfig(process.env);
