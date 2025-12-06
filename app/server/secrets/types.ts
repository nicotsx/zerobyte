/**
 * Secret Provider Framework Types
 *
 * Supports multiple secret sources:
 * - encv1:... - Encrypted secrets stored in DB (native encryption)
 * - op://vault/item/field - 1Password Connect
 * - vault://path/to/secret:key - HashiCorp Vault
 * - env://VAR_NAME - Environment variable (reads ENV_VAR_NAME)
 * - file://name - File-based secrets (reads /run/secrets/name)
 */

// Re-export shared constants from schemas
export { BUILTIN_SECRET_SCHEMES, ENCRYPTED_SECRET_PREFIX } from "~/schemas/secrets";
import type { BuiltinSecretScheme } from "~/schemas/secrets";

// Alias for backward compatibility
export type SecretScheme = BuiltinSecretScheme;

/**
 * Secret provider interface - all providers must implement this
 */
export interface SecretProvider {
	/** The URI scheme this provider handles (e.g., "op", "vault", "env") */
	readonly scheme: SecretScheme | string;

	/** Display name for the provider */
	readonly name: string;

	/**
	 * Check if this provider can handle the given reference
	 * @param ref - The secret reference string
	 */
	supports(ref: string): boolean;

	/**
	 * Retrieve the secret value for the given reference
	 * @param ref - The secret reference (e.g., "op://vault/item/field")
	 * @returns The secret value
	 * @throws Error if the secret cannot be retrieved
	 */
	get(ref: string): Promise<string>;

	/**
	 * Optional health check to verify provider connectivity
	 * @returns true if the provider is healthy
	 */
	healthCheck?(): Promise<boolean>;
}

/**
 * Configuration for 1Password Connect provider (self-hosted)
 */
export interface OnePasswordConfig {
	/** 1Password Connect server URL (e.g., "http://op-connect:8080") */
	connectHost: string;
	/** 1Password Connect API token */
	connectToken: string;
	/** Whether to verify SSL certificates (default: true) */
	verifySsl?: boolean;
}

/**
 * Configuration for HashiCorp Vault provider
 */
export interface HashiCorpVaultConfig {
	/** Vault server URL (e.g., "https://vault.example.com:8200") */
	vaultAddr: string;
	/** Authentication token for Vault */
	vaultToken: string;
	/** Vault namespace (for Vault Enterprise) */
	vaultNamespace?: string;
	/** Secrets engine mount path (default: "secret") */
	mountPath?: string;
	/** Whether to verify SSL certificates (default: true) */
	verifySsl?: boolean;
}

/**
 * Combined configuration for all secret providers
 */
export interface SecretProvidersConfig {
	onePassword?: OnePasswordConfig;
	vault?: HashiCorpVaultConfig;
}

/**
 * Parsed secret reference
 */
export interface ParsedSecretRef {
	/** The scheme/provider (e.g., "op", "vault") */
	scheme: string;
	/** The path portion of the reference */
	path: string;
	/** Optional field/key within the secret */
	field?: string;
	/** The original reference string */
	original: string;
}

/**
 * Result of secret resolution
 */
export interface SecretResolutionResult {
	/** The resolved secret value */
	value: string;
	/** The source of the secret */
	source: "encrypted-db" | "provider" | "plaintext";
	/** The provider scheme if from a provider */
	scheme?: string;
}

/**
 * Browsable secret structure for providers that support listing
 */
export interface SecretBrowserNode {
	/** Unique identifier within parent */
	id: string;
	/** Display name */
	name: string;
	/** Node type */
	type: "vault" | "item" | "field" | "folder" | "variable";
	/** Full URI reference (for selectable nodes like fields) */
	uri?: string;
	/** Whether this node has children (for lazy loading) */
	hasChildren?: boolean;
	/** Child nodes (if already loaded) */
	children?: SecretBrowserNode[];
}

/**
 * Provider interface extension for browsable providers
 */
export interface BrowsableSecretProvider extends SecretProvider {
	/**
	 * Browse available secrets at a given path
	 * @param path - Optional path to browse (e.g., vault name for 1Password)
	 * @returns Array of browsable nodes
	 */
	browse(path?: string): Promise<SecretBrowserNode[]>;
}

/**
 * Type guard to check if a provider supports browsing
 */
export function isBrowsableProvider(provider: SecretProvider): provider is BrowsableSecretProvider {
	return typeof (provider as BrowsableSecretProvider).browse === "function";
}
