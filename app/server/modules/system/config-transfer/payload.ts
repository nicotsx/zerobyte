import { z } from "zod";
import { decodeConfigTransferPayloadV1 } from "./v1/codec";
import { UnsupportedConfigTransferVersionError } from "./errors";
import { validateConfigTransferGraph } from "./graph";
import type { ConfigTransferModel } from "./model";
import { configTransferPayloadV1Schema } from "./v1/payload";

import { decodeConfigTransferPayloadV2, encodeConfigTransferPayloadV2 } from "./v2/codec";
import { configTransferPayloadV2Schema, type ConfigTransferPayloadV2 } from "./v2/payload";
import { migrateConfigTransferV1ToV2 } from "./v2/migrate-v1";

const configTransferVersionSchema = z.object({ version: z.number().int().positive().safe() });

export const CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION = 2;

export const encodeCurrentConfigTransferPayload = (payload: ConfigTransferModel): ConfigTransferPayloadV2 => {
	return encodeConfigTransferPayloadV2(validateConfigTransferGraph(payload));
};

export const parseConfigTransferPayload = (raw: unknown): ConfigTransferModel => {
	const { version } = configTransferVersionSchema.parse(raw);

	switch (version) {
		case 1:
			return validateConfigTransferGraph(
				migrateConfigTransferV1ToV2(decodeConfigTransferPayloadV1(configTransferPayloadV1Schema.parse(raw))),
			);
		case 2:
			return validateConfigTransferGraph(decodeConfigTransferPayloadV2(configTransferPayloadV2Schema.parse(raw)));
		default:
			throw new UnsupportedConfigTransferVersionError(version, CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION);
	}
};
