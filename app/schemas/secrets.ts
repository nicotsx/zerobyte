import { type } from "arktype";

/**
 * Shared secret constants and schemas
 *
 * Used by both client and server for consistent secret handling.
 */

/**
 * Built-in secret provider schemes (always available)
 * These providers don't require configuration and are registered at startup.
 */
export const BUILTIN_SECRET_SCHEMES = ["env", "file"] as const;

export type BuiltinSecretScheme = (typeof BUILTIN_SECRET_SCHEMES)[number];

/**
 * Prefix used for encrypted secrets stored in DB (legacy/fallback)
 */
export const ENCRYPTED_SECRET_PREFIX = "encv1";

/**
 * Built-in provider metadata for UI display
 * These providers are always available and require no configuration
 */
export interface BuiltinProviderMetadata {
	id: string;
	name: string;
	description: string;
	prefix: string;
	example: string;
	browsable: boolean;
}

export const BUILTIN_PROVIDER_METADATA: BuiltinProviderMetadata[] = [
	{
		id: "env",
		name: "Environment Variables",
		description: "Reference environment variables with ENV_ prefix",
		prefix: "env://",
		example: "env://MY_SECRET → reads ENV_MY_SECRET",
		browsable: true,
	},
	{
		id: "file",
		name: "Docker Secrets",
		description: "Reference files in /run/secrets/",
		prefix: "file://",
		example: "file://db_password → reads /run/secrets/db_password",
		browsable: true,
	},
	{
		id: "native",
		name: "Native Encryption",
		description: "Store secrets encrypted in the database",
		prefix: `${ENCRYPTED_SECRET_PREFIX}:`,
		example: "Raw values are encrypted at rest",
		browsable: false,
	},
];

// ============================================================================
// Secret Provider Schemas
// ============================================================================

/**
 * 1Password Connect configuration
 */
export const onePasswordConnectConfigSchema = type({
	type: "'op-connect'",
	connectHost: "string",
	connectToken: "string",
	"verifySsl?": "boolean",
});

/**
 * HashiCorp Vault configuration
 */
export const hashiCorpVaultConfigSchema = type({
	type: "'hc-vault'",
	vaultAddr: "string",
	vaultToken: "string",
	"vaultNamespace?": "string",
	"mountPath?": "string",
	"verifySsl?": "boolean",
});

/**
 * Union of all provider config types
 */
export const secretProviderConfigSchema = onePasswordConnectConfigSchema.or(hashiCorpVaultConfigSchema);

export type SecretProviderConfigInput = typeof secretProviderConfigSchema.infer;

/**
 * Update version - token is optional (to keep existing)
 */
export const updateOnePasswordConnectConfigSchema = type({
	type: "'op-connect'",
	connectHost: "string",
	"connectToken?": "string",
	"verifySsl?": "boolean",
});

export const updateHashiCorpVaultConfigSchema = type({
	type: "'hc-vault'",
	vaultAddr: "string",
	"vaultToken?": "string",
	"vaultNamespace?": "string",
	"mountPath?": "string",
	"verifySsl?": "boolean",
});

export const updateSecretProviderConfigSchema = updateOnePasswordConnectConfigSchema.or(
	updateHashiCorpVaultConfigSchema,
);

export type UpdateSecretProviderConfigInput = typeof updateSecretProviderConfigSchema.infer;

/**
 * Schema for custom URI prefix.
 * Must start with lowercase letter and contain only lowercase letters and hyphens.
 * Max 20 characters to keep URIs reasonable.
 * Empty string is allowed (means use default prefix).
 */
export const customPrefixSchema = type("/^$|^[a-z][a-z-]{0,19}$/");

/**
 * Create secret provider request body
 */
export const createSecretProviderSchema = type({
	name: "string",
	"customPrefix?": customPrefixSchema,
	config: secretProviderConfigSchema,
});

export type CreateSecretProviderBody = typeof createSecretProviderSchema.infer;

/**
 * Update secret provider request body
 */
export const updateSecretProviderSchema = type({
	"name?": "string",
	"enabled?": "boolean",
	"customPrefix?": customPrefixSchema,
	"config?": updateSecretProviderConfigSchema,
});

export type UpdateSecretProviderBody = typeof updateSecretProviderSchema.infer;

/**
 * Provider types supported
 */
export const SECRET_PROVIDER_TYPES = {
	"op-connect": "op-connect",
	"hc-vault": "hc-vault",
} as const;

export type SecretProviderType = keyof typeof SECRET_PROVIDER_TYPES;

/**
 * Field types for provider configuration forms
 */
export type ProviderFieldType = "url" | "secret" | "text" | "switch";

export interface ProviderFieldConfig {
	/** Field name (maps to form values) */
	name: string;
	/** Display label */
	label: string;
	/** Field type */
	type: ProviderFieldType;
	/** Placeholder text */
	placeholder?: string;
	/** Placeholder for edit mode (secrets) */
	editPlaceholder?: string;
	/** Help text for create mode */
	helpText?: string;
	/** Help text for edit mode */
	editHelpText?: string;
	/** Whether the field is required */
	required?: boolean;
	/** Default value */
	defaultValue?: string | boolean;
}

export interface ProviderMetadata {
	label: string;
	description: string;
	defaultPrefix: string;
	uriExample: string;
	/** Configuration fields for this provider */
	fields: ProviderFieldConfig[];
	/** Build config object from form values */
	buildConfig: (values: Record<string, unknown>) => SecretProviderConfigInput;
}

/**
 * Provider metadata for UI display and configuration
 */
export const SECRET_PROVIDER_METADATA: Record<SecretProviderType, ProviderMetadata> = {
	"op-connect": {
		label: "1Password Connect",
		description: "Self-hosted Connect server",
		defaultPrefix: "op",
		uriExample: "prefix://vault/item/field",
		buildConfig: (values) => ({
			type: "op-connect" as const,
			connectHost: values.connectHost as string,
			connectToken: values.connectToken as string,
			verifySsl: values.verifySsl as boolean | undefined,
		}),
		fields: [
			{
				name: "connectHost",
				label: "Connect Server URL",
				type: "url",
				placeholder: "https://op-connect:8080",
				helpText: "The URL of your 1Password Connect server",
				required: true,
			},
			{
				name: "connectToken",
				label: "Connect Token",
				type: "secret",
				placeholder: "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
				editPlaceholder: "••••••••••••••••••••••••",
				helpText: "API token for authenticating with the Connect server. Supports env:// or file:// references.",
				editHelpText: "Leave empty to keep current token, or enter a new token to update it",
				required: true,
			},
			{
				name: "verifySsl",
				label: "Verify SSL Certificate",
				type: "switch",
				helpText: "Disable if using a self-signed certificate",
				defaultValue: true,
			},
		],
	},
	"hc-vault": {
		label: "HashiCorp Vault",
		description: "Centralized secrets management",
		defaultPrefix: "vault",
		uriExample: "prefix://path/to/secret:key",
		buildConfig: (values) => ({
			type: "hc-vault" as const,
			vaultAddr: values.vaultAddr as string,
			vaultToken: values.vaultToken as string,
			vaultNamespace: (values.vaultNamespace as string) || undefined,
			mountPath: (values.mountPath as string) || undefined,
			verifySsl: values.verifySsl as boolean | undefined,
		}),
		fields: [
			{
				name: "vaultAddr",
				label: "Vault Address",
				type: "url",
				placeholder: "https://vault.example.com:8200",
				helpText: "The URL of your HashiCorp Vault server",
				required: true,
			},
			{
				name: "vaultToken",
				label: "Vault Token",
				type: "secret",
				placeholder: "hvs.CAESIJlWps...",
				editPlaceholder: "••••••••••••••••••••••••",
				helpText: "Authentication token for Vault. Supports env:// or file:// references.",
				editHelpText: "Leave empty to keep current token, or enter a new token to update it",
				required: true,
			},
			{
				name: "vaultNamespace",
				label: "Namespace (Optional)",
				type: "text",
				placeholder: "admin",
				helpText: "Vault namespace for Enterprise deployments",
			},
			{
				name: "mountPath",
				label: "Secrets Engine Mount Path (Optional)",
				type: "text",
				placeholder: "secret",
				helpText: "The mount path of the KV v2 secrets engine (default: \"secret\")",
			},
			{
				name: "verifySsl",
				label: "Verify SSL Certificate",
				type: "switch",
				helpText: "Disable if using a self-signed certificate",
				defaultValue: true,
			},
		],
	},
};
