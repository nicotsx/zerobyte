/**
 * Secrets Provider Framework
 *
 * Provides a unified interface for resolving secrets from multiple sources:
 * - Encrypted secrets stored in DB (backward compatible with encv1: prefix)
 * - External secret providers (1Password Connect, HashiCorp Vault)
 * - Environment variables (env://) and files (file://)
 *
 * @example
 * ```typescript
 * import { resolveSecret, resolveSecretConfig, getSecretResolver } from './secrets';
 *
 * // Resolve a single secret
 * const opSecret = await resolveSecret("op://my-vault/credentials/password");
 * const vaultSecret = await resolveSecret("vault://secret/data/myapp:api_key");
 * const legacySecret = await resolveSecret("encv1:salt:iv:encrypted:tag"); // Still works!
 * const envSecret = await resolveSecret("env://DB_PASSWORD"); // From ENV_DB_PASSWORD
 * const fileSecret = await resolveSecret("file://api-key"); // From /run/secrets/api-key
 *
 * // Resolve all secrets in a config object
 * const config = await resolveSecretConfig({
 *   endpoint: "https://s3.amazonaws.com",
 *   accessKeyId: "op://my-vault/aws/access-key",
 *   secretAccessKey: "vault://secret/data/aws:secret_key",
 * });
 *
 * // Register a dynamic provider (e.g., from DB configuration)
 * const resolver = getSecretResolver();
 * resolver.registerProvider(new OnePasswordConnectProvider(config, "op"));
 * resolver.registerProvider(new HashiCorpVaultProvider(config, "vault"));
 * ```
 */

// Types
export type {
	SecretProvider,
	BrowsableSecretProvider,
	SecretScheme,
	SecretProvidersConfig,
	OnePasswordConfig,
	HashiCorpVaultConfig,
	ParsedSecretRef,
	SecretResolutionResult,
	SecretBrowserNode,
} from "./types";

export { isBrowsableProvider } from "./types";

// Re-export shared constants directly from schema
export { BUILTIN_SECRET_SCHEMES, ENCRYPTED_SECRET_PREFIX } from "~/schemas/secrets";

// Utilities
export {
	isEncryptedSecret,
	isSecretRef,
	needsResolution,
	getSecretScheme,
	parseSecretRef,
	parseOnePasswordRef,
	parseEnvRef,
	parseFileRef,
	createSecretRef,
	maskSecret,
	maskSecretRef,
} from "./utils";

// Providers
export {
	BaseSecretProvider,
	EnvSecretProvider,
	FileSecretProvider,
	OnePasswordConnectProvider,
	HashiCorpVaultProvider,
	createProviders,
	checkProvidersHealth,
} from "./providers";

// Resolver
export {
	SecretResolver,
	getSecretResolver,
	initializeSecretResolver,
	resolveSecret,
	resolveSecretConfig,
} from "./resolver";
