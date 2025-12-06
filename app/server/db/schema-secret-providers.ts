import { sql } from "drizzle-orm";
import { int, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { SECRET_PROVIDER_TYPES, SECRET_PROVIDER_METADATA, type SecretProviderType } from "~/schemas/secrets";

/**
 * Secret Providers Table
 * Stores configuration for external secret providers (1Password, Vault, etc.)
 *
 * Note: Provider credentials (tokens, etc.) are encrypted using cryptoUtils
 * before storage - these are the bootstrap secrets that enable all other secrets.
 */
export const secretProvidersTable = sqliteTable("secret_providers_table", {
	id: int().primaryKey({ autoIncrement: true }),
	/** Unique identifier for the provider (e.g., "primary-1password", "prod-vault") */
	name: text().notNull().unique(),
	/** Provider type: op-connect */
	type: text().$type<SecretProviderType>().notNull(),
	/** Whether this provider is enabled */
	enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
	/**
	 * Custom URI prefix for this provider (e.g., "op", "vault", "secret")
	 * If null, uses the default prefix for the provider type
	 */
	customPrefix: text("custom_prefix"),
	/** Provider-specific configuration (encrypted sensitive fields) */
	config: text("config", { mode: "json" }).$type<SecretProviderDbConfig>().notNull(),
	/** Last successful health check */
	lastHealthCheck: integer("last_health_check", { mode: "number" }),
	/** Last health check status */
	healthStatus: text("health_status").$type<"healthy" | "unhealthy" | "unknown">().default("unknown"),
	/** Last error message if unhealthy */
	lastError: text("last_error"),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export type SecretProvider = typeof secretProvidersTable.$inferSelect;
export type NewSecretProvider = typeof secretProvidersTable.$inferInsert;

// Re-export from shared schema for backward compatibility
export { SECRET_PROVIDER_TYPES, type SecretProviderType } from "~/schemas/secrets";

/**
 * Default URI prefixes for each provider type
 * Derived from shared provider metadata
 */
export const DEFAULT_PROVIDER_PREFIXES: Record<SecretProviderType, string> = Object.fromEntries(
	Object.entries(SECRET_PROVIDER_METADATA).map(([type, meta]) => [type, meta.defaultPrefix]),
) as Record<SecretProviderType, string>;

/**
 * Configuration types for each provider stored in DB
 * Sensitive fields are encrypted before storage
 */
export type OnePasswordConnectDbConfig = {
	type: "op-connect";
	/** 1Password Connect server URL */
	connectHost: string;
	/** Encrypted 1Password Connect token */
	connectToken: string;
	/** Whether to verify SSL certificates (default: true) */
	verifySsl?: boolean;
};

export type HashiCorpVaultDbConfig = {
	type: "hc-vault";
	/** Vault server URL */
	vaultAddr: string;
	/** Encrypted Vault token */
	vaultToken: string;
	/** Vault namespace (for Vault Enterprise) */
	vaultNamespace?: string;
	/** Secrets engine mount path (default: "secret") */
	mountPath?: string;
	/** Whether to verify SSL certificates (default: true) */
	verifySsl?: boolean;
};

export type SecretProviderDbConfig = OnePasswordConnectDbConfig | HashiCorpVaultDbConfig;
