import { z } from "zod";
import { decodeConfigTransferPayloadV1 } from "./v1/codec";
import { UnsupportedConfigTransferVersionError } from "./errors";
import { validateConfigTransferGraph } from "./graph";
import type { ConfigTransferModel } from "./model";
import { configTransferPayloadV1Schema } from "./v1/payload";

import { decodeConfigTransferPayloadV2 } from "./v2/codec";
import { configTransferPayloadV2Schema } from "./v2/payload";
import { migrateConfigTransferV1ToV2 } from "./v2/migrate-v1";
import { decodeConfigTransferPayloadV3, encodeConfigTransferPayloadV3 } from "./v3/codec";
import { configTransferPayloadV3Schema, type ConfigTransferPayloadV3 } from "./v3/payload";
import { migrateConfigTransferV2ToV3 } from "./v3/migrate-v2";

const configTransferVersionSchema = z.object({ version: z.number().int().positive().safe() });

export const CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION = 3;

export const encodeCurrentConfigTransferPayload = (payload: ConfigTransferModel): ConfigTransferPayloadV3 => {
	return encodeConfigTransferPayloadV3(validateConfigTransferGraph(payload));
};

export const parseConfigTransferPayload = (raw: unknown): ConfigTransferModel => {
	const { version } = configTransferVersionSchema.parse(raw);

	switch (version) {
		case 1:
			return validateConfigTransferGraph(
				migrateConfigTransferV2ToV3(
					migrateConfigTransferV1ToV2(
						decodeConfigTransferPayloadV1(configTransferPayloadV1Schema.parse(raw)),
					),
				),
			);
		case 2:
			return validateConfigTransferGraph(
				migrateConfigTransferV2ToV3(decodeConfigTransferPayloadV2(configTransferPayloadV2Schema.parse(raw))),
			);
		case 3:
			return validateConfigTransferGraph(decodeConfigTransferPayloadV3(configTransferPayloadV3Schema.parse(raw)));
		default:
			throw new UnsupportedConfigTransferVersionError(version, CURRENT_CONFIG_TRANSFER_PAYLOAD_VERSION);
	}
};
