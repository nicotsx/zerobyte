/**
 * Client-side secret constants and utilities
 *
 * Re-exports from shared schemas for use in client components.
 */

import { BUILTIN_SECRET_SCHEMES, ENCRYPTED_SECRET_PREFIX } from "~/schemas/secrets";

export { BUILTIN_SECRET_SCHEMES, ENCRYPTED_SECRET_PREFIX };
export type { BuiltinSecretScheme } from "~/schemas/secrets";

/**
 * Check if a value is a secret reference based on registered schemes
 */
export function isSecretRef(value: string | undefined | null, registeredSchemes: string[]): boolean {
	if (!value || typeof value !== "string") return false;
	return registeredSchemes.some((scheme) => value.startsWith(`${scheme}://`));
}

/**
 * Check if a value is an encrypted secret (encv1:...)
 */
export function isEncryptedSecret(value: string | undefined | null): boolean {
	if (!value || typeof value !== "string") return false;
	return value.startsWith(`${ENCRYPTED_SECRET_PREFIX}:`);
}
