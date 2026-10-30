import { BadRequestError } from "http-errors-enhanced";
import { cryptoUtils } from "./crypto";

import { STORED_SECRET } from "~/lib/stored-secret";

export { STORED_SECRET };

export const sealNewSecret = async (value: string) => {
	if (value === STORED_SECRET || cryptoUtils.isEncrypted(value)) {
		throw new BadRequestError("Secret values must be provided as plaintext");
	}

	return await cryptoUtils.sealSecret(value);
};

export const preserveOrSealSecret = async (value: string, storedValue: string | undefined, allowPreserve: boolean) => {
	if (value !== STORED_SECRET) {
		if (allowPreserve && storedValue && cryptoUtils.isEncrypted(storedValue)) {
			const storedPlaintext = await cryptoUtils.resolveSecret(storedValue).catch(() => undefined);
			if (storedPlaintext === value) return storedValue;
		}

		return await sealNewSecret(value);
	}

	if (!allowPreserve) {
		throw new BadRequestError("Credentials must be re-entered when the destination changes");
	}

	if (!storedValue) {
		throw new BadRequestError("Stored credential is unavailable");
	}

	return storedValue;
};
