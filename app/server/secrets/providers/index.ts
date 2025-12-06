import type { SecretProvider } from "../types";
import { EnvSecretProvider } from "./env";
import { FileSecretProvider } from "./file";
import { logger } from "../../utils/logger";

export { BaseSecretProvider } from "./base";
export { EnvSecretProvider } from "./env";
export { FileSecretProvider } from "./file";
export { OnePasswordConnectProvider } from "./onepassword";
export { HashiCorpVaultProvider } from "./vault";

/**
 * Create the built-in secret providers (always available)
 *
 * External providers (1Password, Vault, etc.) are created dynamically
 * from database configuration via provider-registry.ts
 *
 * @returns Array of built-in secret providers
 */
export function createProviders(): SecretProvider[] {
	const providers: SecretProvider[] = [
		new EnvSecretProvider(),
		new FileSecretProvider(),
	];

	logger.debug(`Registered ${providers.length} built-in secret providers`, {
		providers: providers.map((p) => p.name),
	});

	return providers;
}

/**
 * Check health of all providers
 *
 * @param providers - Array of secret providers
 * @returns Map of provider name to health status
 */
export async function checkProvidersHealth(
	providers: SecretProvider[],
): Promise<Map<string, { healthy: boolean; error?: string }>> {
	const results = new Map<string, { healthy: boolean; error?: string }>();

	await Promise.all(
		providers.map(async (provider) => {
			try {
				const healthy = provider.healthCheck ? await provider.healthCheck() : true;
				results.set(provider.name, { healthy });
			} catch (error) {
				results.set(provider.name, {
					healthy: false,
					error: (error as Error).message,
				});
			}
		}),
	);

	return results;
}
