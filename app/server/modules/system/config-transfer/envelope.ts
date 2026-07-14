import { z } from "zod";
import {
	CONFIG_TRANSFER_MAX_FILE_BYTES,
	CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH,
	CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH,
} from "~/lib/config-transfer";
import { InvalidConfigTransferEnvelopeError, UnsupportedConfigTransferEnvelopeVersionError } from "./errors";
import { CONFIG_TRANSFER_ENVELOPE_ROUTING_PREFIX } from "./routing";
import {
	CONFIG_TRANSFER_ENVELOPE_VERSION_V1,
	decryptConfigTransferPayloadV1,
	encryptConfigTransferPayloadV1,
} from "./v1/envelope";

const configTransferPassphraseSchema = z
	.string()
	.min(CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH)
	.max(CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH);

const createEnvelopePrefix = (version: number) => `${CONFIG_TRANSFER_ENVELOPE_ROUTING_PREFIX}v${version}:`;

const parseEnvelopeHeader = (encryptedConfig: string) => {
	if (Buffer.byteLength(encryptedConfig, "utf8") > CONFIG_TRANSFER_MAX_FILE_BYTES) {
		throw new InvalidConfigTransferEnvelopeError();
	}

	const versionMatch = encryptedConfig.match(new RegExp(`^${CONFIG_TRANSFER_ENVELOPE_ROUTING_PREFIX}v(\\d+):`));
	if (!versionMatch) {
		throw new InvalidConfigTransferEnvelopeError();
	}

	const version = Number(versionMatch[1]);
	if (!Number.isSafeInteger(version) || versionMatch[0] !== createEnvelopePrefix(version)) {
		throw new InvalidConfigTransferEnvelopeError();
	}

	return {
		version,
		serializedEnvelope: encryptedConfig.slice(versionMatch[0].length),
	};
};

export const encryptConfigTransferPayload = async (plaintext: string, passphrase: string): Promise<string> => {
	configTransferPassphraseSchema.parse(passphrase);

	const serializedEnvelope = await encryptConfigTransferPayloadV1(plaintext, passphrase);
	const encryptedConfig = `${createEnvelopePrefix(CONFIG_TRANSFER_ENVELOPE_VERSION_V1)}${serializedEnvelope}`;

	if (Buffer.byteLength(encryptedConfig, "utf8") > CONFIG_TRANSFER_MAX_FILE_BYTES) {
		throw new Error("Encrypted configuration export exceeds the supported size");
	}

	return encryptedConfig;
};

export const decryptConfigTransferPayload = async (encryptedConfig: string, passphrase: string): Promise<string> => {
	configTransferPassphraseSchema.parse(passphrase);
	const { version, serializedEnvelope } = parseEnvelopeHeader(encryptedConfig);

	switch (version) {
		case CONFIG_TRANSFER_ENVELOPE_VERSION_V1:
			return await decryptConfigTransferPayloadV1(serializedEnvelope, passphrase);
		default:
			throw new UnsupportedConfigTransferEnvelopeVersionError(version);
	}
};
