import { z } from "zod";
import { configTransferPayloadV1Schema, type ConfigTransferPayloadV1 } from "./v1/payload";

export type CurrentConfigTransferPayload = ConfigTransferPayloadV1;

const configTransferVersionSchema = z.object({ version: z.number().int() });

const adaptConfigTransferPayloadV1 = (payload: ConfigTransferPayloadV1): CurrentConfigTransferPayload => payload;

export const parseCurrentConfigTransferPayload = (raw: unknown): CurrentConfigTransferPayload => {
	return configTransferPayloadV1Schema.parse(raw);
};

export const parseConfigTransferPayload = (raw: unknown): CurrentConfigTransferPayload => {
	const { version } = configTransferVersionSchema.parse(raw);

	switch (version) {
		case 1:
			return adaptConfigTransferPayloadV1(configTransferPayloadV1Schema.parse(raw));
		default:
			throw new Error(`Unsupported config transfer version: ${version}`);
	}
};
