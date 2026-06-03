function ensureIntegrationEnv(): void {
	process.env.NODE_ENV ??= "production";
	process.env.LOG_LEVEL ??= "warn";
	process.env.BASE_URL ??= "http://localhost:4096";
	process.env.TRUSTED_ORIGINS ??= process.env.BASE_URL;
	process.env.APP_SECRET ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

async function main(): Promise<void> {
	ensureIntegrationEnv();

	const { runBackendIntegration } = await import("./runner");
	await runBackendIntegration();
}

await main();

export {};
