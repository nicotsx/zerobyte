import { test, describe, expect } from "bun:test";
import { type } from "arktype";

// Re-create the schema to test in isolation (avoids side effects from importing config)
const createEnvSchema = () =>
	type({
		NODE_ENV: type.enumerated("development", "production", "test").default("production"),
		SERVER_IP: 'string = "localhost"',
		SERVER_IDLE_TIMEOUT: 'string.integer.parse = "60"',
		RESTIC_HOSTNAME: "string = 'zerobyte'",
		PORT: 'string.integer.parse = "4096"',
		"MIGRATIONS_PATH?": "string",
	}).pipe((s) => ({
		__prod__: s.NODE_ENV === "production",
		environment: s.NODE_ENV,
		serverIp: s.SERVER_IP,
		serverIdleTimeout: s.SERVER_IDLE_TIMEOUT,
		resticHostname: s.RESTIC_HOSTNAME,
		port: s.PORT,
		migrationsPath: s.MIGRATIONS_PATH,
	}));

describe("config", () => {
	describe("PORT", () => {
		test("should default to 4096 when not set", () => {
			const schema = createEnvSchema();
			const result = schema({});

			expect(result).not.toBeInstanceOf(type.errors);
			if (!(result instanceof type.errors)) {
				expect(result.port).toBe(4096);
			}
		});

		test("should parse PORT as integer", () => {
			const schema = createEnvSchema();
			const result = schema({ PORT: "8080" });

			expect(result).not.toBeInstanceOf(type.errors);
			if (!(result instanceof type.errors)) {
				expect(result.port).toBe(8080);
			}
		});

		test("should reject non-integer PORT", () => {
			const schema = createEnvSchema();
			const result = schema({ PORT: "not-a-number" });

			expect(result).toBeInstanceOf(type.errors);
		});
	});

	describe("MIGRATIONS_PATH", () => {
		test("should be undefined when not set", () => {
			const schema = createEnvSchema();
			const result = schema({});

			expect(result).not.toBeInstanceOf(type.errors);
			if (!(result instanceof type.errors)) {
				expect(result.migrationsPath).toBeUndefined();
			}
		});

		test("should accept a valid path", () => {
			const schema = createEnvSchema();
			const result = schema({ MIGRATIONS_PATH: "/custom/migrations" });

			expect(result).not.toBeInstanceOf(type.errors);
			if (!(result instanceof type.errors)) {
				expect(result.migrationsPath).toBe("/custom/migrations");
			}
		});
	});
});
