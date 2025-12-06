/**
 * Provider Registry
 *
 * Maps provider types to their implementation classes.
 * This is the only file that needs to be updated when adding a new provider
 * (besides the provider class itself and schema definitions).
 */

import type { SecretProvider } from "../../secrets/types";
import type { SecretProviderType } from "~/schemas/secrets";
/**
 * import { SomeSecretProvider } from "../../secrets/providers/some-provider";
 * -- IGNORE --
 */
import { OnePasswordConnectProvider } from "../../secrets/providers/onepassword";
import { HashiCorpVaultProvider } from "../../secrets/providers/vault";

/**
 * Factory function type for creating provider instances
 */
type ProviderFactory = (config: Record<string, unknown>, customPrefix?: string) => SecretProvider;

/**
 * Registry of provider factories by type
 *
 * To add a new provider:
 * 1. Import the provider class
 * 2. Add an entry mapping the type to a factory function
 */
const PROVIDER_FACTORIES: Record<SecretProviderType, ProviderFactory> = {
    /**
     * "some-provider": (config, customPrefix) =>
     *     new SomeSecretProvider(
     *         {
     *             someField: config.someField as string,
     *             anotherField: config.anotherField as number,
     *             // ...other config fields
     *         },
     *         customPrefix,
     *     ),
     * -- IGNORE --
     */
	"op-connect": (config, customPrefix) =>
		new OnePasswordConnectProvider(
			{
				connectHost: config.connectHost as string,
				connectToken: config.connectToken as string,
				verifySsl: config.verifySsl as boolean | undefined,
			},
			customPrefix,
		),
	"hc-vault": (config, customPrefix) =>
		new HashiCorpVaultProvider(
			{
				vaultAddr: config.vaultAddr as string,
				vaultToken: config.vaultToken as string,
				vaultNamespace: config.vaultNamespace as string | undefined,
				mountPath: config.mountPath as string | undefined,
				verifySsl: config.verifySsl as boolean | undefined,
			},
			customPrefix,
		),
};

/**
 * Create a provider instance from config
 */
export function createProviderInstance(
	type: SecretProviderType,
	config: Record<string, unknown>,
	customPrefix?: string | null,
): SecretProvider {
	const factory = PROVIDER_FACTORIES[type];
	if (!factory) {
		throw new Error(`Unknown provider type: ${type}`);
	}
	return factory(config, customPrefix || undefined);
}

export const providerRegistry = {
	createProviderInstance,
};
