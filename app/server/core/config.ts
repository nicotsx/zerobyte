import { type } from "arktype";
import "dotenv/config";

const envSchema = type({
	NODE_ENV: type.enumerated("development", "production", "test").default("production"),
	PORT: 'string.integer.parse = "4096"',
	SERVER_IP: 'string = "localhost"',
	SERVER_IDLE_TIMEOUT: 'string.integer.parse = "60"',
	RESTIC_HOSTNAME: "string = 'zerobyte'",
	MIGRATIONS_PATH: "string?",
}).pipe((s) => ({
	__prod__: s.NODE_ENV === "production",
	environment: s.NODE_ENV,
	port: s.PORT,
	serverIp: s.SERVER_IP,
	serverIdleTimeout: s.SERVER_IDLE_TIMEOUT,
	resticHostname: s.RESTIC_HOSTNAME,
	migrationsPath: s.MIGRATIONS_PATH,
}));

const parseConfig = (env: unknown) => {
	const result = envSchema(env);

	if (result instanceof type.errors) {
		console.error(`Environment variable validation failed: ${result.toString()}`);
		throw new Error("Invalid environment variables");
	}

	return result;
};

export const config = parseConfig(process.env);
