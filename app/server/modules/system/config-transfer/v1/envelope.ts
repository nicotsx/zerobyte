import crypto from "node:crypto";
import { z } from "zod";
import { CONFIG_TRANSFER_MAX_PAYLOAD_BYTES } from "~/lib/config-transfer";
import { InvalidConfigTransferEnvelopeError } from "../errors";

export const CONFIG_TRANSFER_ENVELOPE_VERSION_V1 = 1;

// This is part of the v1 authenticated-data format and must remain unchanged.
const CONFIG_TRANSFER_ENVELOPE_V1_AAD_MAGIC = "zbcfg";
const SCRYPT_COST = 2 ** 16;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 2;
const SCRYPT_MAX_MEMORY = 128 * 1024 * 1024;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

const canonicalBase64UrlSchema = z
	.string()
	.min(1)
	.regex(/^[A-Za-z0-9_-]+$/)
	.refine((value) => {
		const decoded = Buffer.from(value, "base64url");
		return decoded.toString("base64url") === value;
	});

const encodedBytesSchema = (byteLength: number) =>
	canonicalBase64UrlSchema.refine((value) => {
		const decoded = Buffer.from(value, "base64url");
		return decoded.byteLength === byteLength;
	});

const ciphertextSchema = canonicalBase64UrlSchema.refine((value) => {
	const decoded = Buffer.from(value, "base64url");
	return decoded.byteLength <= CONFIG_TRANSFER_MAX_PAYLOAD_BYTES;
});

const configTransferEnvelopeV1Schema = z
	.object({
		envelopeVersion: z.literal(CONFIG_TRANSFER_ENVELOPE_VERSION_V1),
		kdf: z
			.object({
				name: z.literal("scrypt"),
				salt: encodedBytesSchema(SALT_BYTES),
				cost: z.literal(SCRYPT_COST),
				blockSize: z.literal(SCRYPT_BLOCK_SIZE),
				parallelization: z.literal(SCRYPT_PARALLELIZATION),
				keyBytes: z.literal(KEY_BYTES),
			})
			.strict(),
		cipher: z
			.object({
				name: z.literal("aes-256-gcm"),
				nonce: encodedBytesSchema(NONCE_BYTES),
				authTag: encodedBytesSchema(AUTH_TAG_BYTES),
			})
			.strict(),
		ciphertext: ciphertextSchema,
	})
	.strict();

type ConfigTransferEnvelopeV1 = z.infer<typeof configTransferEnvelopeV1Schema>;

const deriveFileKey = (passphrase: string, salt: Buffer, kdf: ConfigTransferEnvelopeV1["kdf"]): Promise<Buffer> => {
	return new Promise((resolve, reject) => {
		crypto.scrypt(
			passphrase,
			salt,
			kdf.keyBytes,
			{
				cost: kdf.cost,
				blockSize: kdf.blockSize,
				parallelization: kdf.parallelization,
				maxmem: SCRYPT_MAX_MEMORY,
			},
			(error, key) => {
				if (error) {
					reject(error);
					return;
				}

				resolve(key);
			},
		);
	});
};

const createAssociatedData = (
	kdf: ConfigTransferEnvelopeV1["kdf"],
	cipher: Omit<ConfigTransferEnvelopeV1["cipher"], "authTag">,
) => {
	// This exact UTF-8 JSON shape and property order are part of the frozen v1 wire format.
	const authenticatedKdf = {
		name: kdf.name,
		salt: kdf.salt,
		cost: kdf.cost,
		blockSize: kdf.blockSize,
		parallelization: kdf.parallelization,
		keyBytes: kdf.keyBytes,
	};
	const authenticatedCipher = {
		name: cipher.name,
		nonce: cipher.nonce,
	};
	const authenticatedMetadata = {
		magic: CONFIG_TRANSFER_ENVELOPE_V1_AAD_MAGIC,
		envelopeVersion: CONFIG_TRANSFER_ENVELOPE_VERSION_V1,
		kdf: authenticatedKdf,
		cipher: authenticatedCipher,
	};
	const serializedMetadata = JSON.stringify(authenticatedMetadata);

	return Buffer.from(serializedMetadata);
};

const parseEnvelopeV1 = (serializedEnvelope: string): ConfigTransferEnvelopeV1 => {
	try {
		return configTransferEnvelopeV1Schema.parse(JSON.parse(serializedEnvelope));
	} catch {
		throw new InvalidConfigTransferEnvelopeError();
	}
};

export const encryptConfigTransferPayloadV1 = async (plaintext: string, passphrase: string): Promise<string> => {
	const plaintextBuffer = Buffer.from(plaintext);
	const plaintextByteLength = plaintextBuffer.byteLength;
	if (plaintextByteLength === 0 || plaintextByteLength > CONFIG_TRANSFER_MAX_PAYLOAD_BYTES) {
		plaintextBuffer.fill(0);
		throw new Error("Configuration transfer payload must be non-empty and within the supported size");
	}

	const salt = crypto.randomBytes(SALT_BYTES);
	const nonce = crypto.randomBytes(NONCE_BYTES);
	const kdf: ConfigTransferEnvelopeV1["kdf"] = {
		name: "scrypt",
		salt: salt.toString("base64url"),
		cost: SCRYPT_COST,
		blockSize: SCRYPT_BLOCK_SIZE,
		parallelization: SCRYPT_PARALLELIZATION,
		keyBytes: KEY_BYTES,
	};
	const cipherMetadata: Omit<ConfigTransferEnvelopeV1["cipher"], "authTag"> = {
		name: "aes-256-gcm",
		nonce: nonce.toString("base64url"),
	};
	let key: Buffer | undefined;

	try {
		key = await deriveFileKey(passphrase, salt, kdf);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
		cipher.setAAD(createAssociatedData(kdf, cipherMetadata));
		const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
		const envelope: ConfigTransferEnvelopeV1 = {
			envelopeVersion: CONFIG_TRANSFER_ENVELOPE_VERSION_V1,
			kdf,
			cipher: {
				...cipherMetadata,
				authTag: cipher.getAuthTag().toString("base64url"),
			},
			ciphertext: ciphertext.toString("base64url"),
		};

		return JSON.stringify(envelope);
	} finally {
		key?.fill(0);
		plaintextBuffer.fill(0);
	}
};

export const decryptConfigTransferPayloadV1 = async (
	serializedEnvelope: string,
	passphrase: string,
): Promise<string> => {
	const envelope = parseEnvelopeV1(serializedEnvelope);
	const salt = Buffer.from(envelope.kdf.salt, "base64url");
	const nonce = Buffer.from(envelope.cipher.nonce, "base64url");
	const authTag = Buffer.from(envelope.cipher.authTag, "base64url");
	const ciphertext = Buffer.from(envelope.ciphertext, "base64url");
	const key = await deriveFileKey(passphrase, salt, envelope.kdf);
	let plaintextUpdate: Buffer | undefined;
	let plaintextFinal: Buffer | undefined;
	let plaintext: Buffer | undefined;

	try {
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
		decipher.setAAD(
			createAssociatedData(envelope.kdf, {
				name: envelope.cipher.name,
				nonce: envelope.cipher.nonce,
			}),
		);
		decipher.setAuthTag(authTag);

		try {
			plaintextUpdate = decipher.update(ciphertext);
			plaintextFinal = decipher.final();
			plaintext = Buffer.concat([plaintextUpdate, plaintextFinal]);
		} catch {
			throw new InvalidConfigTransferEnvelopeError();
		}

		if (plaintext.byteLength > CONFIG_TRANSFER_MAX_PAYLOAD_BYTES) {
			throw new InvalidConfigTransferEnvelopeError();
		}

		return plaintext.toString();
	} finally {
		plaintext?.fill(0);
		plaintextUpdate?.fill(0);
		plaintextFinal?.fill(0);
		key.fill(0);
	}
};
