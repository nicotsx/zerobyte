import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { CONFIG_TRANSFER_MAX_FILE_BYTES } from "~/lib/config-transfer";
import { decryptConfigTransferPayload, encryptConfigTransferPayload } from "../envelope";
import { InvalidConfigTransferEnvelopeError } from "../errors";
import { CONFIG_TRANSFER_ENVELOPE_ROUTING_PREFIX } from "../routing";

const passphrase = "a strong export passphrase";

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

		expect(CONFIG_TRANSFER_ENVELOPE_ROUTING_PREFIX).toBe("zbcfg:");
		expect(await decryptConfigTransferPayload(fixture.encryptedConfig, fixture.passphrase)).toBe(fixture.plaintext);
	});

	test("rejects wrong passphrases and modified ciphertext", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);
		const lastCharacter = encrypted.at(-1);
		const tampered = `${encrypted.slice(0, -1)}${lastCharacter === "A" ? "B" : "A"}`;

		await expect(decryptConfigTransferPayload(encrypted, "a different passphrase")).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
		await expect(decryptConfigTransferPayload(tampered, passphrase)).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});

	test("rejects modified encryption parameters", async () => {
		const encrypted = await encryptConfigTransferPayload("sensitive payload", passphrase);
		const prefix = "zbcfg:v1:";
		const envelope = JSON.parse(encrypted.slice(prefix.length));
		envelope.kdf.cost *= 2;

		await expect(
			decryptConfigTransferPayload(`${prefix}${JSON.stringify(envelope)}`, passphrase),
		).rejects.toBeInstanceOf(InvalidConfigTransferEnvelopeError);
	});

	test("rejects oversized files before parsing", async () => {
		const oversized = "x".repeat(CONFIG_TRANSFER_MAX_FILE_BYTES + 1);

		await expect(decryptConfigTransferPayload(oversized, passphrase)).rejects.toBeInstanceOf(
			InvalidConfigTransferEnvelopeError,
		);
	});
});
