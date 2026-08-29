import { BadRequestError } from "http-errors-enhanced";

export const INVALID_CONFIG_TRANSFER_MESSAGE = "Invalid export file or passphrase";

export class InvalidConfigTransferError extends BadRequestError {
	readonly name = "InvalidConfigTransferError";

	constructor() {
		super(INVALID_CONFIG_TRANSFER_MESSAGE);
	}
}

export class InvalidConfigTransferEnvelopeError extends Error {
	readonly name = "InvalidConfigTransferEnvelopeError";

	constructor() {
		super("Invalid configuration transfer envelope");
	}
}

export class UnsupportedConfigTransferEnvelopeVersionError extends Error {
	readonly name = "UnsupportedConfigTransferEnvelopeVersionError";

	constructor(version: number) {
		super(
			`Unsupported config export encryption version: ${version}. Use a Zerobyte release that supports this export to convert it to a newer format.`,
		);
	}
}

export class UnsupportedConfigTransferVersionError extends Error {
	readonly name = "UnsupportedConfigTransferVersionError";

	constructor(version: number) {
		super(
			`Unsupported config transfer version: ${version}. Use a Zerobyte release that supports this export to convert it to a newer format.`,
		);
	}
}
