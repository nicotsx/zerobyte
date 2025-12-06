/**
 * DTO schemas for Secret Providers API
 *
 * Re-exports shared schemas from ~/schemas/secrets
 */

import type { SecretProviderType } from "~/schemas/secrets";

// Re-export shared schemas for use in controllers
export {
	secretProviderConfigSchema,
	updateSecretProviderConfigSchema,
	customPrefixSchema,
	createSecretProviderSchema,
	updateSecretProviderSchema,
	SECRET_PROVIDER_TYPES,
} from "~/schemas/secrets";

// Re-export types
export type {
	SecretProviderConfigInput,
	UpdateSecretProviderConfigInput,
	CreateSecretProviderBody,
	UpdateSecretProviderBody,
	SecretProviderType,
} from "~/schemas/secrets";

/**
 * Response types (server-only, not shared)
 */
export type SecretProviderResponse = {
	id: number;
	name: string;
	type: SecretProviderType;
	enabled: boolean;
	/** The URI prefix used for this provider (e.g., "op://") */
	uriPrefix: string;
	/** Custom prefix if set, null if using default */
	customPrefix: string | null;
	healthStatus: "healthy" | "unhealthy" | "unknown";
	lastHealthCheck: number | null;
	lastError: string | null;
	createdAt: number;
	updatedAt: number;
	// Note: config is NOT returned for security - only non-sensitive summary fields
	configSummary: Record<string, unknown>;
};
