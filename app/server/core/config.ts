import { readFileSync } from "node:fs";
import os from "node:os";
import { prettifyError, z } from "zod";
import "dotenv/config";
import { buildAllowedHosts } from "../lib/auth/base-url";
import { toMessage } from "@zerobyte/core/utils";

const unquote = (str: string) => str.trim().replace(/^(['"])(.*)\1$/, "$2");
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
		APP_SECRET: z.preprocess((value) => (value === "" ? undefined : value), z.string().min(32).max(256).optional()),
		APP_SECRET_FILE: z.string().optional(),
		BASE_URL: z.string(),
		ENABLE_DEV_PANEL: z.string().default("false"),
		PROVISIONING_PATH: z.string().optional(),
	})
	.transform((s, ctx) => {
		const baseUrl = unquote(s.BASE_URL);
		const trustedOrigins = s.TRUSTED_ORIGINS?.split(",").map(unquote).filter(Boolean).concat(baseUrl) ?? [baseUrl];
		const authOrigins = [baseUrl, ...trustedOrigins];
		const { allowedHosts, invalidOrigins } = buildAllowedHosts(authOrigins);
		let appSecret = s.APP_SECRET;

		if (!appSecret && !s.APP_SECRET_FILE) {
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
			].join("\n");

			ctx.addIssue({
				code: "custom",
				message: errorMessage,
			});
		}

		if (s.APP_SECRET && s.APP_SECRET_FILE) {
			ctx.addIssue({
				code: "custom",
				message: "Both APP_SECRET and APP_SECRET_FILE are set. Please set only one of these.",
			});
		}

		if (s.APP_SECRET_FILE) {
			try {
				appSecret = readFileSync(s.APP_SECRET_FILE, "utf-8").trim();
				if (appSecret.length < 32 || appSecret.length > 256) {
					ctx.addIssue({
						code: "custom",
						message: "The secret read from APP_SECRET_FILE must be between 32 and 256 characters long.",
					});
				}
			} catch (err) {
				ctx.addIssue({
					code: "custom",
					message: `Failed to read APP_SECRET from file: ${toMessage(err)}`,
				});
			}
		}

		for (const origin of invalidOrigins) {
			console.warn(
				`Ignoring invalid origin in configuration: ${origin}. Make sure it is a valid URL with a protocol (e.g. https://example.com)`,
			);
		}

		if (allowedHosts.length === 0) {
			ctx.addIssue({
				code: "custom",
				message:
					"No valid trusted origins provided. Please check the BASE_URL and TRUSTED_ORIGINS environment variables.",
			});
		}

		return {
			__prod__: s.NODE_ENV === "production",
			environment: s.NODE_ENV,
			serverIp: s.SERVER_IP,
			serverIdleTimeout: s.SERVER_IDLE_TIMEOUT,
			resticHostname: s.RESTIC_HOSTNAME || getResticHostname(),
			port: s.PORT,
			migrationsPath: s.MIGRATIONS_PATH,
			appVersion: s.APP_VERSION,
			trustedOrigins: trustedOrigins,
			trustProxy: s.TRUST_PROXY === "true",
			disableRateLimiting: s.DISABLE_RATE_LIMITING === "true" || s.NODE_ENV === "test",
			appSecret: appSecret ?? "",
			baseUrl,
			isSecure: baseUrl.startsWith("https://"),
			enableDevPanel: s.ENABLE_DEV_PANEL === "true",
			provisioningPath: s.PROVISIONING_PATH,
			allowedHosts,
		};
	});

export const parseConfig = (env: unknown) => {
	const result = envSchema.safeParse(env);

	if (!result.success) {
		console.error(`Environment variable validation failed: ${prettifyError(result.error)}`);
		process.exit(1);
	}

	if (!result.data.appSecret) {
		console.error(
			"APP_SECRET is required but was not provided. Please set the APP_SECRET environment variable or provide a file with APP_SECRET_FILE.",
		);
		process.exit(1);
	}

	return result.data;
};

export const config = parseConfig(process.env);
