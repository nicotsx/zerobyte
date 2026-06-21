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

type EncryptionOptions = {
	prefix: string;
	secret: string;
};

type DecryptionOptions = EncryptionOptions & {
	passthroughIfNotEncrypted?: boolean;
};

const deriveEncryptionKey = (secret: string, salt: Buffer) => {
	return crypto.pbkdf2Sync(secret, salt, 100000, keyLength, "sha256");
};

const isEncryptedWithPrefix = (value: string | undefined, prefix: string): boolean => {
	return typeof value === "string" && value.startsWith(prefix);
};

/**
 * Checks if a given string is encrypted by looking for the encryption prefix.
 */
const isEncrypted = (val?: string): boolean => {
	return isEncryptedWithPrefix(val, encryptionPrefix);
};

const encryptWithSecret = async (data: string, { prefix, secret }: EncryptionOptions) => {
	if (!data) {
		return data;
	}

	if (isEncryptedWithPrefix(data, prefix)) {
		try {
			await decryptWithSecret(data, { prefix, secret });
			return data;
		} catch {
			throw new Error(
				prefix === encryptionPrefix
					? "You have provided an encrypted value that cannot be decrypted with the current APP_SECRET. Please use a plain text value."
					: "You have provided an encrypted value that cannot be decrypted with the current secret. Please use a plain text value.",
			);
		}
	}

	const salt = crypto.randomBytes(16);
	const iv = crypto.randomBytes(12);
	const key = deriveEncryptionKey(secret, salt);
	const cipher = crypto.createCipheriv(algorithm, key, iv);
	const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
	const tag = cipher.getAuthTag();

	return `${prefix}${salt.toString("hex")}:${iv.toString("hex")}:${encrypted.toString("hex")}:${tag.toString("hex")}`;
};

const decryptWithSecret = async (
	encryptedData: string,
	{ passthroughIfNotEncrypted = false, prefix, secret }: DecryptionOptions,
) => {
	if (!isEncryptedWithPrefix(encryptedData, prefix)) {
		if (passthroughIfNotEncrypted) {
			return encryptedData;
		}

		throw new Error("Invalid encrypted payload");
	}

	const parts = encryptedData.slice(prefix.length).split(":");
	if (parts.length !== 4) {
		throw new Error("Invalid encrypted payload");
	}

	const [saltHex, ivHex, encryptedHex, tagHex] = parts;
	const salt = Buffer.from(saltHex, "hex");
	const iv = Buffer.from(ivHex, "hex");
	const encrypted = Buffer.from(encryptedHex, "hex");
	const tag = Buffer.from(tagHex, "hex");
	const key = deriveEncryptionKey(secret, salt);
	const decipher = crypto.createDecipheriv(algorithm, key, iv);

	decipher.setAuthTag(tag);

	let decrypted = decipher.update(encrypted);
	decrypted = Buffer.concat([decrypted, decipher.final()]);

	return decrypted.toString();
};

/**
 * Given a string, encrypts it using a randomly generated salt and the APP_SECRET.
 * Returns the input unchanged if it's empty or already encrypted.
 */
const encrypt = async (data: string) => {
	return encryptWithSecret(data, {
		prefix: encryptionPrefix,
		secret: config.appSecret,
	});
};

/**
 * Given an encrypted string, decrypts it using the salt stored in the string and the APP_SECRET.
 * Returns the input unchanged if it's not encrypted (for backward compatibility).
 */
const decrypt = async (encryptedData: string) => {
	return decryptWithSecret(encryptedData, {
		passthroughIfNotEncrypted: true,
		prefix: encryptionPrefix,
		secret: config.appSecret,
	});
};

const resolveSecretWithSecret = async (value: string, secret: string): Promise<string> => {
	return decryptWithSecret(value, {
		passthroughIfNotEncrypted: true,
		prefix: encryptionPrefix,
		secret,
	});
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

function timingSafeEqualString(provided: string, expected: string): boolean {
	const providedBuffer = Buffer.from(provided);
	const expectedBuffer = Buffer.from(expected);

	return (
		providedBuffer.byteLength === expectedBuffer.byteLength &&
		crypto.timingSafeEqual(providedBuffer, expectedBuffer)
	);
}

export const cryptoUtils = {
	decryptWithSecret,
	encryptWithSecret,
	resolveSecretWithSecret,
	resolveSecret,
	sealSecret,
	sealOptionalSecret,
	deriveSecret,
	generateResticPassword,
	timingSafeEqualString,
	isEncrypted,
};
