import { ENCRYPTED_SECRET_PREFIX, BUILTIN_SECRET_SCHEMES, type ParsedSecretRef } from "./types";

/**
 * Built-in secret reference prefixes (always available)
 * Dynamic providers register their own schemes at runtime via the resolver.
 */
const BUILTIN_PREFIXES = BUILTIN_SECRET_SCHEMES.map((scheme) => `${scheme}://`);

/**
 * Pattern to detect URI-like values: scheme://...
 * Scheme must start with lowercase letter, can contain lowercase letters and hyphens
 */
const URI_PATTERN = /^([a-z][a-z-]*):\/\//;

/**
 * Check if a value is an encrypted secret (stored in DB)
 * These start with the encryption prefix (e.g., "encv1:...")
 *
 * @param value - The value to check
 * @returns true if the value is an encrypted DB secret
 */
export function isEncryptedSecret(value: string): boolean {
	return value.startsWith(`${ENCRYPTED_SECRET_PREFIX}:`);
}

/**
 * Check if a value is a secret provider reference
 *
 * Checks built-in schemes (env://, file://) and optionally additional registered schemes.
 *
 * @param value - The value to check
 * @param registeredSchemes - Optional array of additional registered provider schemes (e.g., ["op", "vault"])
 * @returns true if the value is a secret reference
 */
export function isSecretRef(value: string, registeredSchemes?: string[]): boolean {
	// Check built-in prefixes first
	if (BUILTIN_PREFIXES.some((prefix) => value.startsWith(prefix))) {
		return true;
	}

	// Check registered dynamic provider schemes if provided
	if (registeredSchemes && registeredSchemes.length > 0) {
		return registeredSchemes.some((scheme) => value.startsWith(`${scheme}://`));
	}

	return false;
}

/**
 * Check if a value needs secret resolution (either encrypted or a built-in reference)
 *
 * Note: This only checks built-in schemes. For complete detection including dynamic
 * providers, use the resolver's needsResolution() method.
 *
 * @param value - The value to check
 * @param registeredSchemes - Optional array of additional registered provider schemes
 * @returns true if the value needs resolution
 */
export function needsResolution(value: string | undefined | null, registeredSchemes?: string[]): value is string {
	if (!value || typeof value !== "string") {
		return false;
	}
	return isEncryptedSecret(value) || isSecretRef(value, registeredSchemes);
}

/**
 * Get the scheme from a secret reference
 *
 * @param ref - The secret reference (e.g., "op://vault/item/field")
 * @returns The scheme (e.g., "op") or null if not a valid reference
 */
export function getSecretScheme(ref: string): string | null {
	const match = ref.match(URI_PATTERN);
	return match ? match[1] : null;
}

/**
 * Parse a secret reference into its components
 *
 * Supported formats:
 * - op://vault/item/field
 * - env://VAR_NAME
 * - file:///path/to/secret
 *
 * @param ref - The secret reference string
 * @returns Parsed reference object
 * @throws Error if the reference format is invalid
 */
export function parseSecretRef(ref: string): ParsedSecretRef {
	const scheme = getSecretScheme(ref);

	if (!scheme) {
		throw new Error(`Invalid secret reference format: ${ref}`);
	}

	// Remove the scheme:// prefix
	const rest = ref.slice(scheme.length + 3);

	// Check for field selector (using # separator)
	const hashIndex = rest.indexOf("#");
	let path: string;
	let field: string | undefined;

	if (hashIndex !== -1) {
		path = rest.slice(0, hashIndex);
		const fieldPart = rest.slice(hashIndex + 1);
		// Parse field=value format
		if (fieldPart.startsWith("field=")) {
			field = fieldPart.slice(6);
		} else {
			field = fieldPart;
		}
	} else {
		path = rest;
	}

	return {
		scheme,
		path,
		field,
		original: ref,
	};
}

/**
 * Parse a 1Password-style reference (scheme://vault/item/field)
 * Works with both the default "op" prefix and custom prefixes.
 *
 * @param ref - The 1Password-style reference
 * @returns Object with vault, item, and field
 */
export function parseOnePasswordRef(ref: string): { vault: string; item: string; field: string } {
	const parsed = parseSecretRef(ref);

	// Format: scheme://vault/item/field
	const parts = parsed.path.split("/").filter(Boolean);

	if (parts.length < 3) {
		throw new Error(`Invalid 1Password reference format. Expected scheme://vault/item/field, got: ${ref}`);
	}

	return {
		vault: parts[0],
		item: parts[1],
		field: parts.slice(2).join("/"), // Field can contain slashes
	};
}

/**
 * Parse an environment variable reference (env://VAR_NAME)
 *
 * @param ref - The env reference
 * @returns The variable name
 */
export function parseEnvRef(ref: string): string {
	const parsed = parseSecretRef(ref);

	if (parsed.scheme !== "env") {
		throw new Error(`Not an environment variable reference: ${ref}`);
	}

	return parsed.path;
}

/**
 * Parse a file reference (file:///path/to/secret)
 *
 * @param ref - The file reference
 * @returns The file path
 */
export function parseFileRef(ref: string): string {
	const parsed = parseSecretRef(ref);

	if (parsed.scheme !== "file") {
		throw new Error(`Not a file reference: ${ref}`);
	}

	// For file://, the path starts with / (file:///path becomes /path)
	return `/${parsed.path}`;
}

/**
 * Create a secret reference string
 *
 * @param scheme - The provider scheme
 * @param path - The secret path
 * @param field - Optional field selector
 * @returns The formatted reference string
 */
export function createSecretRef(scheme: string, path: string, field?: string): string {
	const base = `${scheme}://${path}`;
	return field ? `${base}#${field}` : base;
}

/**
 * Mask a secret value for logging (show only first/last few chars)
 *
 * @param value - The secret value to mask
 * @param visibleChars - Number of chars to show at start and end (default: 2)
 * @returns Masked string
 */
export function maskSecret(value: string, visibleChars = 2): string {
	if (value.length <= visibleChars * 2 + 3) {
		return "***";
	}
	return `${value.slice(0, visibleChars)}***${value.slice(-visibleChars)}`;
}

/**
 * Mask a secret reference for logging (hide sensitive parts)
 *
 * @param ref - The secret reference
 * @returns Masked reference safe for logging
 */
export function maskSecretRef(ref: string): string {
	if (isEncryptedSecret(ref)) {
		return `${ENCRYPTED_SECRET_PREFIX}:***`;
	}

	const scheme = getSecretScheme(ref);
	if (!scheme) {
		return "***";
	}

	// For references, we can show the scheme and partially mask the path
	try {
		const parsed = parseSecretRef(ref);
		const pathParts = parsed.path.split("/").filter(Boolean);

		if (pathParts.length > 1) {
			// Show first part, mask the rest
			return `${scheme}://${pathParts[0]}/***${parsed.field ? "#***" : ""}`;
		}

		return `${scheme}://***`;
	} catch {
		return `${scheme}://***`;
	}
}
