export class InvalidConfigTransferEnvelopeError extends Error {}

export class UnsupportedConfigTransferEnvelopeVersionError extends Error {
	constructor(version: number) {
		super(
			`Unsupported config export encryption version: ${version}. Use a Zerobyte release that supports this export to convert it to a newer format.`,
		);
	}
}
