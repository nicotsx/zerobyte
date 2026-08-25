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
