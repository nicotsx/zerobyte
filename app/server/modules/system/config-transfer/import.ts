import { BadRequestError } from "http-errors-enhanced";
import { decryptConfigTransferPayload } from "./envelope";
import {
	InvalidConfigTransferEnvelopeError,
	InvalidConfigTransferError,
	UnsupportedConfigTransferEnvelopeVersionError,
	UnsupportedConfigTransferVersionError,
} from "./errors";
import { parseConfigTransferPayload } from "./payload";
import { prepareConfigImport } from "./prepare-import";
import { assertConfigImportAllowed, storePreparedConfigImport } from "./store";

const decodeEncryptedPayload = async (encryptedConfig: string, exportPassphrase: string) => {
	let decryptedPayload: string;

	try {
		decryptedPayload = await decryptConfigTransferPayload(encryptedConfig, exportPassphrase);
	} catch (error) {
		if (error instanceof UnsupportedConfigTransferEnvelopeVersionError) {
			throw new BadRequestError(error.message);
		}
		if (error instanceof InvalidConfigTransferEnvelopeError) {
			throw new InvalidConfigTransferError();
		}

		throw error;
	}

	let rawPayload: unknown;
	try {
		rawPayload = JSON.parse(decryptedPayload) as unknown;
	} catch {
		throw new InvalidConfigTransferError();
	}

	try {
		return parseConfigTransferPayload(rawPayload);
	} catch (error) {
		if (error instanceof UnsupportedConfigTransferVersionError) {
			throw new BadRequestError(error.message);
		}

		throw new InvalidConfigTransferError();
	}
};

export const importPassphraseProtectedOrganizationConfig = async (
	organizationId: string,
	userId: string,
	encryptedConfig: string,
	exportPassphrase: string,
) => {
	assertConfigImportAllowed(organizationId, userId);
	const payload = await decodeEncryptedPayload(encryptedConfig, exportPassphrase);
	const preparedImport = await prepareConfigImport(payload);
	const imported = storePreparedConfigImport(organizationId, userId, preparedImport.prepared);

	return { imported, warnings: preparedImport.warnings };
};
