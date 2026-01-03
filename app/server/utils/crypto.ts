import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RESTIC_PASS_FILE } from "../core/constants";
import { isNodeJSErrnoException } from "./fs";

const algorithm = "aes-256-gcm" as const;
const keyLength = 32;
const encryptionPrefix = "encv1:";

const envSecretPrefix = "env://";
const fileSecretPrefix = "file://";

/**
 * Checks if a given string is encrypted by looking for the encryption prefix.
 */
const isEncrypted = (val?: string): boolean => {
	return typeof val === "string" && val.startsWith(encryptionPrefix);
};

/**
 * Checks if a string looks like a supported secret reference.
 * - env://VAR_NAME -> reads process.env.VAR_NAME
 * - file://name -> reads a file /run/secrets/name
 */
const isSecretReference = (val?: string): boolean => {
	return typeof val === "string" && (val.startsWith(envSecretPrefix) || val.startsWith(fileSecretPrefix));
};

/**
 * Resolves an environment variable secret reference.
 */
const resolveEnvSecret = (ref: string): string => {
	const name = ref.slice(envSecretPrefix.length);
	if (!name) {
		throw new Error("env:// reference is missing variable name");
	}

	const value = process.env[name];
	if (value === undefined) {
		throw new Error(`Environment variable not set: ${name}`);
	}

	return value;
};

/**
 * Resolves a file-based secret reference.
 * Reads the secret from /run/secrets/{name}
 */
const resolveFileSecret = async (ref: string): Promise<string> => {
	const secretName = ref.slice(fileSecretPrefix.length);
	if (!secretName) {
		throw new Error("file:// reference is missing secret name");
	}

	const normalizedName = secretName.replace(/^\/+/, "");
	if (!normalizedName) {
		throw new Error("file:// reference is missing secret name");
	}
	if (normalizedName.includes("\0") || normalizedName.includes("/") || normalizedName.includes("\\")) {
		throw new Error("Invalid secret reference: secret name must be a single path segment");
	}

	const resolvedPath = path.join("/run/secrets", normalizedName);

	try {
		const content = await fs.readFile(resolvedPath, "utf-8");
		return content.trimEnd();
	} catch (error) {
		if (isNodeJSErrnoException(error)) {
			if (error.code === "ENOENT") {
				throw new Error(`Secret file not found: ${resolvedPath}`);
			}
			if (error.code === "EACCES") {
				throw new Error(`Permission denied reading secret file: ${resolvedPath}`);
			}
		}
		throw new Error(`Failed to read secret file ${resolvedPath}: ${(error as Error).message}`);
	}
};

/**
 * Given a string, encrypts it using a randomly generated salt.
 * Returns the input unchanged if it's empty or already encrypted.
 */
const encrypt = async (data: string) => {
	if (!data) {
		return data;
	}

	if (isEncrypted(data)) {
		return data;
	}

	const secret = await Bun.file(RESTIC_PASS_FILE).text();

	const salt = crypto.randomBytes(16);
	const key = crypto.pbkdf2Sync(secret, salt, 100000, keyLength, "sha256");
	const iv = crypto.randomBytes(12);

	const cipher = crypto.createCipheriv(algorithm, key, iv);
	const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

	const tag = cipher.getAuthTag();
	return `${encryptionPrefix}${salt.toString("hex")}:${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

/**
 * Given an encrypted string, decrypts it using the salt stored in the string.
 * Returns the input unchanged if it's not encrypted (for backward compatibility).
 */
const decrypt = async (encryptedData: string) => {
	if (!isEncrypted(encryptedData)) {
		return encryptedData;
	}

	const secret = (await Bun.file(RESTIC_PASS_FILE).text()).trim();

	const parts = encryptedData.split(":").slice(1); // Remove prefix
	const saltHex = parts.shift() as string;
	const salt = Buffer.from(saltHex, "hex");

	const key = crypto.pbkdf2Sync(secret, salt, 100000, keyLength, "sha256");

	const iv = Buffer.from(parts.shift() as string, "hex");
	const encrypted = Buffer.from(parts.shift() as string, "hex");
	const tag = Buffer.from(parts.shift() as string, "hex");
	const decipher = crypto.createDecipheriv(algorithm, key, iv);

	decipher.setAuthTag(tag);

	let decrypted = decipher.update(encrypted);
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString();
};

/**
 * Resolves secret references and encrypted database values.
 *
 * - encv1:... -> decrypt
 * - env://VAR -> read process.env.VAR
 * - file://name -> read /run/secrets/name
 * - otherwise returns value unchanged
 */
const resolveSecret = async (value: string): Promise<string> => {
	if (!value) {
		return value;
	}

	if (isEncrypted(value)) {
		return decrypt(value);
	}

	if (value.startsWith(envSecretPrefix)) {
		return resolveEnvSecret(value);
	}

	if (value.startsWith(fileSecretPrefix)) {
		return resolveFileSecret(value);
	}

	return value;
};

/**
 * Prepares a secret value for storage.
 *
 * - env://... and file://... are stored as-is (references)
 * - encv1:... is stored as-is (already encrypted)
 * - otherwise encrypt before storing
 */
const sealSecret = async (value: string): Promise<string> => {
	if (!value) {
		return value;
	}

	if (isEncrypted(value) || isSecretReference(value)) {
		return value;
	}

	return encrypt(value);
};

export const cryptoUtils = {
	resolveSecret,
	sealSecret,
	isEncrypted,
	decrypt,
};
