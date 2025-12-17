import { type } from "arktype";
import "dotenv/config";

const envSchema = type({
	NODE_ENV: type.enumerated("development", "production", "test").default("production"),
	SERVER_IP: 'string = "localhost"',
}).pipe((s) => ({
	__prod__: s.NODE_ENV === "production",
	environment: s.NODE_ENV,
	serverIp: s.SERVER_IP,
}));

const parseConfig = (env: unknown) => {
	const result = envSchema(env);

	if (result instanceof type.errors) {
		throw new Error(`Invalid environment variables: ${result.toString()}`);
	}

	return result;
};

export const config = parseConfig(process.env);
