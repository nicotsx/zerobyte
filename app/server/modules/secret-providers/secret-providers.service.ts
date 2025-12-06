import { eq, ne, and, asc } from "drizzle-orm";
import { BadRequestError, ConflictError, NotFoundError, InternalServerError } from "http-errors-enhanced";
import { db } from "../../db/db";
import {
	secretProvidersTable,
	DEFAULT_PROVIDER_PREFIXES,
	type SecretProviderDbConfig,
	type SecretProviderType,
} from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
import { logger } from "../../utils/logger";
import {
	getSecretResolver,
	type SecretBrowserNode,
	type SecretScheme,
	isBrowsableProvider,
	needsResolution,
	BUILTIN_SECRET_SCHEMES,
	ENCRYPTED_SECRET_PREFIX,
} from "../../secrets";
import { SECRET_PROVIDER_METADATA } from "~/schemas/secrets";
import type {
	CreateSecretProviderBody,
	UpdateSecretProviderBody,
	SecretProviderResponse,
	SecretProviderConfigInput,
} from "./secret-providers.dto";
import { providerRegistry } from "./provider-registry";

/**
 * Get secret field names for a provider type from metadata
 */
function getSecretFields(providerType: SecretProviderType): string[] {
	const metadata = SECRET_PROVIDER_METADATA[providerType];
	if (!metadata) return [];
	return metadata.fields.filter((f) => f.type === "secret").map((f) => f.name);
}

/**
 * Get non-secret field names for a provider type from metadata
 */
function getNonSecretFields(providerType: SecretProviderType): string[] {
	const metadata = SECRET_PROVIDER_METADATA[providerType];
	if (!metadata) return [];
	return metadata.fields.filter((f) => f.type !== "secret").map((f) => f.name);
}

/**
 * Encrypt sensitive fields in provider config before storing in DB
 * Secret references (env://, file://, op://) are stored as-is without encryption
 * Only raw values get encrypted with the encv1: prefix
 */
async function encryptProviderConfig(config: SecretProviderConfigInput): Promise<SecretProviderDbConfig> {
	const secretFields = getSecretFields(config.type);
	const result: Record<string, unknown> = { type: config.type };

	for (const [key, value] of Object.entries(config)) {
		if (key === "type") continue;

		if (secretFields.includes(key) && typeof value === "string" && value) {
			// Encrypt secret fields (unless already a secret reference)
			result[key] = needsResolution(value) ? value : await cryptoUtils.encrypt(value);
		} else {
			result[key] = value;
		}
	}

	return result as SecretProviderDbConfig;
}

/**
 * Decrypt/resolve sensitive fields from provider config
 * Handles:
 * - encv1:... - Decrypt using crypto
 * - env://, file:// - Resolve using secret resolver
 * - Plain values (shouldn't happen but handle gracefully)
 */
async function decryptProviderConfig(config: SecretProviderDbConfig): Promise<SecretProviderConfigInput> {
	const secretFields = getSecretFields(config.type);
	const resolver = getSecretResolver();
	const result: Record<string, unknown> = { type: config.type };

	for (const [key, value] of Object.entries(config)) {
		if (key === "type") continue;

		if (secretFields.includes(key) && typeof value === "string" && value) {
			// Resolve secret fields (decrypt or resolve reference)
			result[key] = await resolver.resolve(value);
		} else {
			result[key] = value;
		}
	}

	return result as SecretProviderConfigInput;
}

/**
 * Get non-sensitive config summary for API responses
 * Excludes secret fields from the response
 */
function getConfigSummary(config: SecretProviderDbConfig): SecretProviderResponse["configSummary"] {
	const nonSecretFields = getNonSecretFields(config.type);
	const summary: Record<string, unknown> = {};

	for (const fieldName of nonSecretFields) {
		const value = (config as Record<string, unknown>)[fieldName];
		if (value !== undefined) {
			summary[fieldName] = value;
		}
	}

	return summary;
}

/**
 * Get effective prefix for a provider (custom or default)
 */
function getEffectivePrefix(customPrefix: string | null | undefined, providerType: SecretProviderType): string {
	return customPrefix || DEFAULT_PROVIDER_PREFIXES[providerType];
}

/**
 * Reserved prefixes that cannot be used by custom providers
 */
const RESERVED_PREFIXES = [...BUILTIN_SECRET_SCHEMES, ENCRYPTED_SECRET_PREFIX];

/**
 * Pattern for valid custom prefix: lowercase letters and hyphens only
 * Must match the pattern used in getSecretScheme() in utils.ts
 */
const VALID_PREFIX_PATTERN = /^[a-z][a-z-]*$/;

/**
 * Validate that a custom prefix is valid for use as a URI scheme
 */
function validateCustomPrefix(prefix: string | undefined | null): void {
	if (!prefix) return;

	const trimmed = prefix.trim();
	if (trimmed !== prefix) {
		throw new BadRequestError("Custom prefix cannot have leading or trailing whitespace");
	}

	if (!VALID_PREFIX_PATTERN.test(prefix)) {
		throw new BadRequestError(
			`Custom prefix "${prefix}" is invalid. ` +
				"Prefix must start with a lowercase letter and contain only lowercase letters and hyphens.",
		);
	}

	if (prefix.length > 20) {
		throw new BadRequestError("Custom prefix cannot be longer than 20 characters");
	}
}

/**
 * Check if a prefix is already used by another provider or is reserved
 */
async function checkPrefixConflict(prefix: string, excludeId?: number): Promise<void> {
	// Check against reserved built-in prefixes
	if (RESERVED_PREFIXES.includes(prefix.toLowerCase())) {
		throw new ConflictError(`The URI prefix "${prefix}" is reserved for built-in providers`);
	}

	const providers = await db.query.secretProvidersTable.findMany();

	for (const provider of providers) {
		if (excludeId && provider.id === excludeId) continue;

		const existingPrefix = getEffectivePrefix(provider.customPrefix, provider.type as SecretProviderType);
		if (existingPrefix === prefix) {
			throw new ConflictError(`A provider with URI prefix "${prefix}://" already exists`);
		}
	}
}

/**
 * Convert DB record to API response
 */
function toResponse(provider: typeof secretProvidersTable.$inferSelect): SecretProviderResponse {
	const providerType = provider.type as SecretProviderType;
	const prefix = getEffectivePrefix(provider.customPrefix, providerType);
	return {
		id: provider.id,
		name: provider.name,
		type: providerType,
		enabled: provider.enabled,
		uriPrefix: `${prefix}://`,
		customPrefix: provider.customPrefix,
		healthStatus: provider.healthStatus ?? "unknown",
		lastHealthCheck: provider.lastHealthCheck,
		lastError: provider.lastError,
		createdAt: provider.createdAt,
		updatedAt: provider.updatedAt,
		configSummary: getConfigSummary(provider.config),
	};
}

/**
 * List all secret providers
 */
const listProviders = async (): Promise<SecretProviderResponse[]> => {
	const providers = await db.query.secretProvidersTable.findMany({
		orderBy: asc(secretProvidersTable.name),
	});
	return providers.map(toResponse);
};

/**
 * Get a single provider by ID
 */
const getProvider = async (id: number): Promise<SecretProviderResponse> => {
	const provider = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.id, id),
	});

	if (!provider) {
		throw new NotFoundError("Secret provider not found");
	}

	return toResponse(provider);
};

/**
 * Create a new secret provider
 */
const createProvider = async (body: CreateSecretProviderBody): Promise<SecretProviderResponse> => {
	const name = body.name.trim();

	if (!name) {
		throw new BadRequestError("Provider name cannot be empty");
	}

	// Validate custom prefix format
	validateCustomPrefix(body.customPrefix);

	const existing = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.name, name),
	});

	if (existing) {
		throw new ConflictError("Secret provider with this name already exists");
	}

	// Check for duplicate prefix
	const effectivePrefix = getEffectivePrefix(body.customPrefix, body.config.type);
	await checkPrefixConflict(effectivePrefix);

	const encryptedConfig = await encryptProviderConfig(body.config);

	const [created] = await db
		.insert(secretProvidersTable)
		.values({
			name,
			type: body.config.type,
			customPrefix: body.customPrefix || null,
			config: encryptedConfig,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create secret provider");
	}

	// Register with the resolver immediately
	await registerProviderWithResolver(created);

	logger.info(`Created secret provider: ${name} (${body.config.type})`);

	return toResponse(created);
};

/**
 * Update an existing secret provider
 */
const updateProvider = async (id: number, updates: UpdateSecretProviderBody): Promise<SecretProviderResponse> => {
	const existing = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.id, id),
	});

	if (!existing) {
		throw new NotFoundError("Secret provider not found");
	}

	const updateData: Partial<typeof secretProvidersTable.$inferInsert> = {
		updatedAt: Date.now(),
	};

	if (updates.name !== undefined) {
		const name = updates.name.trim();

		if (!name) {
			throw new BadRequestError("Provider name cannot be empty");
		}

		const conflict = await db.query.secretProvidersTable.findFirst({
			where: and(eq(secretProvidersTable.name, name), ne(secretProvidersTable.id, id)),
		});

		if (conflict) {
			throw new ConflictError("Secret provider with this name already exists");
		}

		updateData.name = name;
	}

	if (updates.enabled !== undefined) {
		updateData.enabled = updates.enabled;
	}

	if (updates.customPrefix !== undefined) {
		// Validate custom prefix format
		validateCustomPrefix(updates.customPrefix);

		// Check for duplicate prefix
		const existingType = existing.type as SecretProviderType;
		const effectivePrefix = getEffectivePrefix(updates.customPrefix, existingType);
		await checkPrefixConflict(effectivePrefix, id);

		updateData.customPrefix = updates.customPrefix || null;
	}

	if (updates.config !== undefined) {
		// Handle partial config update - merge with existing config if secret fields not provided
		const secretFields = getSecretFields(updates.config.type);
		const existingConfig = existing.config as Record<string, unknown>;

		// Check if any secret field is provided (non-empty)
		const hasNewSecrets = secretFields.some((field) => {
			const value = (updates.config as Record<string, unknown>)[field];
			return typeof value === "string" && value.length > 0;
		});

		if (!hasNewSecrets && existingConfig.type === updates.config.type) {
			// Keep existing encrypted secrets, update other fields
			const mergedConfig: Record<string, unknown> = { ...updates.config };
			for (const field of secretFields) {
				mergedConfig[field] = existingConfig[field]; // Keep existing encrypted value
			}
			updateData.config = mergedConfig as SecretProviderDbConfig;
		} else {
			// New secrets provided, encrypt them
			updateData.config = await encryptProviderConfig(updates.config as SecretProviderConfigInput);
		}
		updateData.type = updates.config.type;
	}

	const [updated] = await db
		.update(secretProvidersTable)
		.set(updateData)
		.where(eq(secretProvidersTable.id, id))
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update secret provider");
	}

	// Re-register with resolver
	await reloadProvidersInResolver();

	logger.info(`Updated secret provider: ${updated.name}`);

	return toResponse(updated);
};

/**
 * Delete a secret provider
 */
const deleteProvider = async (id: number): Promise<void> => {
	const existing = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.id, id),
	});

	if (!existing) {
		throw new NotFoundError("Secret provider not found");
	}

	await db.delete(secretProvidersTable).where(eq(secretProvidersTable.id, id));

	// Reload resolver without this provider
	await reloadProvidersInResolver();

	logger.info(`Deleted secret provider: ${existing.name}`);
};

/**
 * Test provider config before saving (no DB record needed)
 */
const testConfig = async (config: SecretProviderConfigInput): Promise<{ healthy: boolean; error?: string }> => {
	try {
		const instance = providerRegistry.createProviderInstance(
			config.type,
			config as Record<string, unknown>,
			undefined,
		);

		if (!instance) {
			throw new Error("Failed to create provider instance");
		}

		const healthy = instance.healthCheck ? await instance.healthCheck() : true;
		return { healthy };
	} catch (error) {
		const errorMessage = (error as Error).message;
		return { healthy: false, error: errorMessage };
	}
};

/**
 * Test a provider's connectivity
 */
const testProvider = async (id: number): Promise<{ healthy: boolean; error?: string }> => {
	const provider = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.id, id),
	});

	if (!provider) {
		throw new NotFoundError("Secret provider not found");
	}

	try {
		const decryptedConfig = await decryptProviderConfig(provider.config);
		const instance = providerRegistry.createProviderInstance(
			provider.type as SecretProviderType,
			decryptedConfig as Record<string, unknown>,
			provider.customPrefix,
		);

		if (!instance) {
			throw new Error("Failed to create provider instance");
		}

		const healthy = instance.healthCheck ? await instance.healthCheck() : true;

		// Update health status in DB
		await db
			.update(secretProvidersTable)
			.set({
				healthStatus: healthy ? "healthy" : "unhealthy",
				lastHealthCheck: Date.now(),
				lastError: healthy ? null : "Health check failed",
				updatedAt: Date.now(),
			})
			.where(eq(secretProvidersTable.id, id));

		return { healthy };
	} catch (error) {
		const errorMessage = (error as Error).message;

		await db
			.update(secretProvidersTable)
			.set({
				healthStatus: "unhealthy",
				lastHealthCheck: Date.now(),
				lastError: errorMessage,
				updatedAt: Date.now(),
			})
			.where(eq(secretProvidersTable.id, id));

		return { healthy: false, error: errorMessage };
	}
};

/**
 * Register a single provider with the global resolver
 */
async function registerProviderWithResolver(dbProvider: typeof secretProvidersTable.$inferSelect) {
	if (!dbProvider.enabled) return;

	try {
		const decryptedConfig = await decryptProviderConfig(dbProvider.config);
		const instance = providerRegistry.createProviderInstance(
			dbProvider.type as SecretProviderType,
			decryptedConfig as Record<string, unknown>,
			dbProvider.customPrefix,
		);

		if (instance) {
			getSecretResolver().addProvider(instance);
			logger.debug(`Registered provider with resolver: ${dbProvider.name} (prefix: ${instance.scheme}://)`);
		}
	} catch (error) {
		logger.error(`Failed to register provider ${dbProvider.name}:`, error);
	}
}

/**
 * Load all enabled providers from DB and register with resolver
 * Called on application startup
 */
const loadProvidersFromDb = async (): Promise<void> => {
	const providers = await db.query.secretProvidersTable.findMany({
		where: eq(secretProvidersTable.enabled, true),
	});

	logger.info(`Loading ${providers.length} secret providers from database`);

	for (const provider of providers) {
		await registerProviderWithResolver(provider);
	}
};

/**
 * Reload all providers in the resolver
 * Called when providers are updated/deleted
 */
const reloadProvidersInResolver = async (): Promise<void> => {
	// Note: This is a simple approach - for production you might want
	// to implement a more sophisticated provider management system
	// that can add/remove providers without rebuilding the entire list

	logger.debug("Reloading all providers in resolver...");

	// Reinitialize with built-in providers (env, file)
	const { initializeSecretResolver } = await import("../../secrets");
	initializeSecretResolver();

	// Then add DB providers
	await loadProvidersFromDb();

	logger.debug("Finished reloading providers in resolver");
};

/**
 * Browse secrets from a provider
 * @param id - Provider ID (from DB) or "env"/"file" for built-in providers
 * @param path - Optional path within the provider
 */
const browseProvider = async (id: string, path?: string): Promise<SecretBrowserNode[]> => {
	const resolver = getSecretResolver();

	// Handle built-in providers
	if (BUILTIN_SECRET_SCHEMES.includes(id as SecretScheme)) {
		const provider = resolver.getProviderByScheme(id);
		if (!provider) {
			throw new NotFoundError(`Provider '${id}' not found`);
		}
		if (!isBrowsableProvider(provider)) {
			throw new InternalServerError(`Provider '${id}' does not support browsing`);
		}
		return provider.browse(path);
	}

	// Handle DB-configured providers
	const numericId = Number(id);
	if (Number.isNaN(numericId)) {
		throw new NotFoundError("Provider not found");
	}

	const dbProvider = await db.query.secretProvidersTable.findFirst({
		where: eq(secretProvidersTable.id, numericId),
	});

	if (!dbProvider) {
		throw new NotFoundError("Secret provider not found");
	}

	if (!dbProvider.enabled) {
		throw new InternalServerError("Provider is disabled");
	}

	// Get the provider instance from the resolver by its scheme
	const prefix = getEffectivePrefix(dbProvider.customPrefix, dbProvider.type as SecretProviderType);
	const provider = resolver.getProviderByScheme(prefix);

	if (!provider) {
		throw new InternalServerError(`Provider '${dbProvider.name}' is not registered with the resolver`);
	}

	if (!isBrowsableProvider(provider)) {
		throw new InternalServerError(`Provider '${dbProvider.name}' does not support browsing`);
	}

	return provider.browse(path);
};

export const secretProvidersService = {
	listProviders,
	getProvider,
	createProvider,
	updateProvider,
	deleteProvider,
	testProvider,
	testConfig,
	loadProvidersFromDb,
	reloadProvidersInResolver,
	browseProvider,
};
