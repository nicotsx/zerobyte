import { z } from "zod";
import { UnsupportedConfigTransferVersionError } from "./errors";
import { validateConfigTransferGraph } from "./graph";
import type { ConfigTransferModel } from "./model";
import { configTransferPayloadV1Schema, type ConfigTransferPayloadV1 } from "./v1/payload";

const configTransferVersionSchema = z.object({ version: z.number().int() });

const upgradeConfigTransferPayloadV1 = ({ version: _version, ...payload }: ConfigTransferPayloadV1) => {
	return payload;
};

const encodeConfigTransferPayloadV1 = (payload: ConfigTransferModel): ConfigTransferPayloadV1 => {
	return configTransferPayloadV1Schema.parse({ version: 1, ...payload });
};

export const encodeCurrentConfigTransferPayload = (payload: ConfigTransferModel): ConfigTransferPayloadV1 => {
	return encodeConfigTransferPayloadV1(validateConfigTransferGraph(payload));
};

export const parseConfigTransferPayload = (raw: unknown): ConfigTransferModel => {
	const { version } = configTransferVersionSchema.parse(raw);

	switch (version) {
		case 1:
			return validateConfigTransferGraph(
				upgradeConfigTransferPayloadV1(configTransferPayloadV1Schema.parse(raw)),
			);
		default:
			throw new UnsupportedConfigTransferVersionError(version);
	}
};
