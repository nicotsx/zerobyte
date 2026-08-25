import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import {
	CONFIG_TRANSFER_MAX_FILE_BYTES,
	CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH,
	CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH,
} from "~/lib/config-transfer";
import { decryptConfigTransferPayload, encryptConfigTransferPayload } from "../envelope";
import { InvalidConfigTransferEnvelopeError, UnsupportedConfigTransferEnvelopeVersionError } from "../errors";

const passphrase = "a strong export passphrase";
const v1Prefix = "zbcfg:v1:";

type MutableEnvelopeV1 = {
	kdf: {
		salt: string;
		cost: number;
	};
	cipher: {
		nonce: string;
		authTag: string;
	};
	ciphertext: string;
};

const parseEnvelopeV1 = (encryptedConfig: string): MutableEnvelopeV1 => {
	if (!encryptedConfig.startsWith(v1Prefix)) {
		throw new Error("Expected a v1 configuration transfer envelope");
	}

	return JSON.parse(encryptedConfig.slice(v1Prefix.length)) as MutableEnvelopeV1;
};

const serializeEnvelopeV1 = (envelope: MutableEnvelopeV1) => `${v1Prefix}${JSON.stringify(envelope)}`;

const flipFirstEncodedByte = (encoded: string) => {
	const bytes = Buffer.from(encoded, "base64url");
	const firstByte = bytes[0];
	if (firstByte === undefined) {
		throw new Error("Expected encoded bytes");
	}

	bytes[0] = firstByte ^ 1;
	return bytes.toString("base64url");
};

const createNonCanonicalBase64UrlAlias = (encoded: string) => {
	const decoded = Buffer.from(encoded, "base64url");
	const finalCharacterIndex = encoded.length - 1;
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

	for (const character of alphabet) {
		const candidate = `${encoded.slice(0, finalCharacterIndex)}${character}`;
		const candidateBytes = Buffer.from(candidate, "base64url");
		if (candidate !== encoded && candidateBytes.equals(decoded)) {
			return candidate;
		}
	}

	throw new Error("Expected a non-canonical base64url alias");
};

const loadV1CompatibilityFixture = async () => {
	return JSON.parse(
		await readFile(
			new URL("../../__fixtures__/config-transfer/v1-envelope-compatibility.json", import.meta.url),
			"utf8",
		),
	) as {
		passphrase: string;
		plaintext: string;
		encryptedConfig: string;
	};
};

describe("configuration transfer encryption envelope", () => {
	test("round trips authenticated payloads without exposing plaintext", async () => {
		const plaintext = JSON.stringify({ version: 1, secret: "repository-secret" });
		const encrypted = await encryptConfigTransferPayload(plaintext, passphrase);

		expect(encrypted).toMatch(/^zbcfg:v1:/);
		expect(encrypted).not.toContain("repository-secret");
		expect(encrypted).not.toContain(passphrase);
		expect(await decryptConfigTransferPayload(encrypted, passphrase)).toBe(plaintext);
	});

	test("decrypts the frozen v1 compatibility fixture", async () => {
		const fixture = await loadV1CompatibilityFixture();

		expect(await decryptConfigTransferPayload(fixture.encryptedConfig, fixture.passphrase)).toBe(fixture.plaintext);
	});

	test("rejects wrong passphrases", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);

		await expect(decryptConfigTransferPayload(encrypted, "a different passphrase")).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});

	test("rejects authenticated byte modifications", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);
		const ciphertextEnvelope = parseEnvelopeV1(encrypted);
		ciphertextEnvelope.ciphertext = flipFirstEncodedByte(ciphertextEnvelope.ciphertext);
		const authTagEnvelope = parseEnvelopeV1(encrypted);
		authTagEnvelope.cipher.authTag = flipFirstEncodedByte(authTagEnvelope.cipher.authTag);
		const nonceEnvelope = parseEnvelopeV1(encrypted);
		nonceEnvelope.cipher.nonce = flipFirstEncodedByte(nonceEnvelope.cipher.nonce);

		await expect(
			decryptConfigTransferPayload(serializeEnvelopeV1(ciphertextEnvelope), passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
		await expect(
			decryptConfigTransferPayload(serializeEnvelopeV1(authTagEnvelope), passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
		await expect(
			decryptConfigTransferPayload(serializeEnvelopeV1(nonceEnvelope), passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
	});

	test("rejects malformed and non-canonical base64url", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);
		const malformedEnvelope = parseEnvelopeV1(encrypted);
		malformedEnvelope.ciphertext = `${malformedEnvelope.ciphertext}!`;
		const nonCanonicalEnvelope = parseEnvelopeV1(encrypted);
		nonCanonicalEnvelope.cipher.authTag = createNonCanonicalBase64UrlAlias(nonCanonicalEnvelope.cipher.authTag);

		await expect(
			decryptConfigTransferPayload(serializeEnvelopeV1(malformedEnvelope), passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
		await expect(
			decryptConfigTransferPayload(serializeEnvelopeV1(nonCanonicalEnvelope), passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
	});

	test("rejects unsupported v1 encryption parameters", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);
		const envelope = parseEnvelopeV1(encrypted);
		const unsupportedCost = envelope.kdf.cost * 2;
		envelope.kdf.cost = unsupportedCost;

		await expect(decryptConfigTransferPayload(serializeEnvelopeV1(envelope), passphrase)).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});

	test("distinguishes unsupported envelope versions from malformed envelopes", async () => {
		await expect(decryptConfigTransferPayload("zbcfg:v99:{}", passphrase)).rejects.toBeInstanceOf(
			UnsupportedConfigTransferEnvelopeVersionError,
		);
		await expect(decryptConfigTransferPayload("zbcfg:v1:{", passphrase)).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});

	test("enforces the shared passphrase contract", async () => {
		const shortPassphrase = "x".repeat(CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH - 1);
		const longPassphrase = "x".repeat(CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH + 1);

		await expect(encryptConfigTransferPayload("payload", shortPassphrase)).rejects.toThrow();
		await expect(encryptConfigTransferPayload("payload", longPassphrase)).rejects.toThrow();
	});

	test("rejects empty payloads", async () => {
		await expect(encryptConfigTransferPayload("", passphrase)).rejects.toThrow(
			"Configuration transfer payload must be non-empty",
		);
	});

	test("rejects files above the supported size", async () => {
		const oversized = "x".repeat(CONFIG_TRANSFER_MAX_FILE_BYTES + 1);

		await expect(decryptConfigTransferPayload(oversized, passphrase)).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});
});
