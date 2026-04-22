import crypto from "node:crypto";
import { config } from "../core/config";
import { promisify } from "node:util";

const hkdf = promisify(crypto.hkdf);

const algorithm = "aes-256-gcm" as const;
const keyLength = 32;
const encryptionPrefix = "encv1:";

export type SecretTransformer = (value: string) => Promise<string>;

export const transformOptionalSecret = async (
	value: string | undefined,
	transformSecret: SecretTransformer,
): Promise<string | undefined> => {
	if (!value) {
		return value;
	}

	return await transformSecret(value);
};

/**
 * Checks if a given string is encrypted by looking for the encryption prefix.
 */
const isEncrypted = (val?: string): boolean => {
	return typeof val === "string" && val.startsWith(encryptionPrefix);
};

/**
 * Given a string, encrypts it using a randomly generated salt and the APP_SECRET.
 * Returns the input unchanged if it's empty or already encrypted.
 */
const encrypt = async (data: string) => {
	if (!data) {
		return data;
	}

	if (isEncrypted(data)) {
		return data;
	}

	const salt = crypto.randomBytes(16);
	const key = crypto.pbkdf2Sync(config.appSecret, salt, 100000, keyLength, "sha256");
	const iv = crypto.randomBytes(12);

	const cipher = crypto.createCipheriv(algorithm, key, iv);
	const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);

	const tag = cipher.getAuthTag();
	return `${encryptionPrefix}${salt.toString("hex")}:${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

/**
 * Given an encrypted string, decrypts it using the salt stored in the string and the APP_SECRET.
 * Returns the input unchanged if it's not encrypted (for backward compatibility).
 */
const decrypt = async (encryptedData: string) => {
	if (!isEncrypted(encryptedData)) {
		return encryptedData;
	}

	const parts = encryptedData.split(":").slice(1); // Remove prefix
	const saltHex = parts.shift() as string;
	const salt = Buffer.from(saltHex, "hex");

	const key = crypto.pbkdf2Sync(config.appSecret, salt, 100000, keyLength, "sha256");

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
 */
const resolveSecret = async (value: string): Promise<string> => {
	if (isEncrypted(value)) {
		return decrypt(value);
	}

	return value;
};

/**
 * Prepares a secret value for storage.
 */
const sealSecret = async (value: string): Promise<string> => {
	if (isEncrypted(value)) {
		return value;
	}

	return encrypt(value);
};

const sealOptionalSecret = async (value?: string): Promise<string | undefined> => {
	return transformOptionalSecret(value, sealSecret);
};

async function deriveSecret(label: string) {
	const derivedKey = await hkdf("sha256", config.appSecret, "", label, 32);

	return Buffer.from(derivedKey).toString("hex");
}

function generateResticPassword(): string {
	return crypto.randomBytes(32).toString("hex");
}

export const cryptoUtils = {
	resolveSecret,
	sealSecret,
	sealOptionalSecret,
	deriveSecret,
	generateResticPassword,
	isEncrypted,
};
