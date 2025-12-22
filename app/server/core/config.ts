import { type } from "arktype";
import "dotenv/config";

const envSchema = type({
	NODE_ENV: type.enumerated("development", "production", "test").default("production"),
	SERVER_IP: 'string = "localhost"',
	SERVER_IDLE_TIMEOUT: 'string.integer.parse = "60"',
}).pipe((s) => ({
	__prod__: s.NODE_ENV === "production",
	environment: s.NODE_ENV,
	serverIp: s.SERVER_IP,
	serverIdleTimeout: s.SERVER_IDLE_TIMEOUT,
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
