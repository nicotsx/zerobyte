import type { SecretProvider, SecretResolutionResult } from "./types";
import { isEncryptedSecret, isSecretRef, getSecretScheme, maskSecretRef } from "./utils";
import { createProviders, checkProvidersHealth } from "./providers";
import { cryptoUtils } from "../utils/crypto";
import { logger } from "../utils/logger";

/**
 * Secret Resolver
 *
 * Handles resolution of secrets from multiple sources:
 * 1. Encrypted secrets in DB (encv1:...) - backward compatible
 * 2. Secret provider references (op://, vault://, env://, file://)
 * 3. Plain text values (passthrough)
 *
 * Built-in providers (env, file) are always available.
 * External providers (1Password, Vault, etc.) are added dynamically
 * from database configuration via addProvider().
 */
export class SecretResolver {
	private providers: SecretProvider[];

	constructor() {
		// Create built-in providers (env, file)
		this.providers = createProviders();
	}

	/**
	 * Re-initialize the resolver (resets to built-in providers only)
	 */
	initialize(): void {
		this.providers = createProviders();
		logger.info("Secret resolver initialized", {
			providerCount: this.providers.length,
		});
	}

	/**
	 * Add a custom provider
	 */
	addProvider(provider: SecretProvider): void {
		this.providers.push(provider);
		logger.debug(`Added secret provider: ${provider.name}`);
	}

	/**
	 * Resolve a secret value from any supported source
	 *
	 * Detection logic:
	 * - Starts with "encv1:" → Encrypted DB secret → decrypt with cryptoUtils
	 * - Starts with "op://" → 1Password → fetch from Connect API
	 * - Starts with "env://" → Environment variable → read from process.env
	 * - Starts with "file://" → File → read from disk
	 * - Otherwise → Plain text (passthrough)
	 *
	 * @param value - The secret value or reference to resolve
	 * @returns The resolved secret value
	 */
	async resolve(value: string): Promise<string> {
		if (!value) {
			return value;
		}

		// Check for encrypted DB secret (backward compatibility)
		if (isEncryptedSecret(value)) {
			logger.debug("Resolving encrypted DB secret");
			return cryptoUtils.decrypt(value);
		}

		// Check for secret provider reference (both static schemes and dynamic providers)
		const scheme = getSecretScheme(value);
		if (scheme) {
			const provider = this.providers.find((p) => p.supports(value));

			if (provider) {
				logger.debug(`Resolving secret via ${provider.name}`, {
					scheme,
					ref: maskSecretRef(value),
				});

				return provider.get(value);
			}

			// We have a valid scheme:// pattern but no provider registered for it
			throw new Error(
				`No provider available for secret reference: ${maskSecretRef(value)}. ` +
					`Scheme "${scheme}" is not configured.`,
			);
		}

		// Plain text value (passthrough)
		return value;
	}

	/**
	 * Resolve a secret with detailed result information
	 */
	async resolveWithInfo(value: string): Promise<SecretResolutionResult> {
		if (!value) {
			return { value, source: "plaintext" };
		}

		if (isEncryptedSecret(value)) {
			return {
				value: await cryptoUtils.decrypt(value),
				source: "encrypted-db",
			};
		}

		const scheme = getSecretScheme(value);
		if (scheme) {
			const provider = this.providers.find((p) => p.supports(value));
			if (provider) {
				return {
					value: await this.resolve(value),
					source: "provider",
					scheme: scheme,
				};
			}
		}

		return { value, source: "plaintext" };
	}

	/**
	 * Resolve all secret fields in a configuration object
	 *
	 * This handles the pattern where config objects may have:
	 * - Direct encrypted values (e.g., accessKeyId: "encv1:...")
	 * - Provider references (e.g., accessKeyId: "op://...")
	 * - Plain values (e.g., endpoint: "https://...")
	 *
	 * @param config - Configuration object with potential secrets
	 * @param secretFields - Array of field names that contain secrets
	 * @returns Config with all secrets resolved
	 */
	async resolveConfig<T extends Record<string, unknown>>(config: T, secretFields?: string[]): Promise<T> {
		const resolved = { ...config } as Record<string, unknown>;

		for (const [key, value] of Object.entries(config)) {
			// Skip non-string values
			if (typeof value !== "string") {
				continue;
			}

			// If secretFields is specified, only resolve those fields
			if (secretFields && !secretFields.includes(key)) {
				continue;
			}

			// Resolve if it's an encrypted secret or provider reference (check both static and dynamic)
			if (this.needsResolution(value)) {
				resolved[key] = await this.resolve(value);
			}
		}

		return resolved as T;
	}

	/**
	 * Check if a value is a secret that needs resolution
	 * Checks both static schemes and dynamically registered providers
	 */
	needsResolution(value: string | undefined | null): boolean {
		if (!value || typeof value !== "string") {
			return false;
		}

		// Check for encrypted DB secrets
		if (isEncryptedSecret(value)) {
			return true;
		}

		// Check built-in schemes + registered provider schemes
		const registeredSchemes = this.providers.map((p) => p.scheme);
		if (isSecretRef(value, registeredSchemes)) {
			return true;
		}

		return false;
	}

	/**
	 * Check health of all configured providers
	 */
	async healthCheck(): Promise<Map<string, { healthy: boolean; error?: string }>> {
		return checkProvidersHealth(this.providers);
	}

	/**
	 * Get list of available provider schemes
	 */
	getAvailableSchemes(): string[] {
		return this.providers.map((p) => p.scheme);
	}

	/**
	 * Get list of configured providers
	 */
	getProviders(): Array<{ name: string; scheme: string }> {
		return this.providers.map((p) => ({
			name: p.name,
			scheme: p.scheme,
		}));
	}

	/**
	 * Check if a specific scheme is available
	 */
	hasScheme(scheme: string): boolean {
		return this.providers.some((p) => p.scheme === scheme);
	}

	/**
	 * Get a provider by its scheme
	 */
	getProviderByScheme(scheme: string): SecretProvider | undefined {
		return this.providers.find((p) => p.scheme === scheme);
	}
}

// Singleton instance for application-wide use
let secretResolverInstance: SecretResolver | null = null;

/**
 * Get the global secret resolver instance
 * Must be initialized before use via initializeSecretResolver()
 */
export function getSecretResolver(): SecretResolver {
	if (!secretResolverInstance) {
		// Create with empty config - will be initialized later
		secretResolverInstance = new SecretResolver();
	}
	return secretResolverInstance;
}

/**
 * Initialize the global secret resolver
 * Should be called once during application startup
 */
export function initializeSecretResolver(): SecretResolver {
	if (!secretResolverInstance) {
		secretResolverInstance = new SecretResolver();
	} else {
		secretResolverInstance.initialize();
	}
	return secretResolverInstance;
}

/**
 * Convenience function to resolve a secret using the global resolver
 */
export async function resolveSecret(value: string): Promise<string> {
	return getSecretResolver().resolve(value);
}

/**
 * Convenience function to resolve config using the global resolver
 */
export async function resolveSecretConfig<T extends Record<string, unknown>>(
	config: T,
	secretFields?: string[],
): Promise<T> {
	return getSecretResolver().resolveConfig(config, secretFields);
}
