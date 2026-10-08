import { configTransferPayloadV2Schema, type ConfigTransferPayloadV2 } from "./payload";
import type { ConfigTransferModelV2 } from "./model";

export const decodeConfigTransferPayloadV2 = ({
	version: _version,
	...payload
}: ConfigTransferPayloadV2): ConfigTransferModelV2 => {
	return payload;
};

export const encodeConfigTransferPayloadV2 = (payload: ConfigTransferModelV2): ConfigTransferPayloadV2 => {
	return configTransferPayloadV2Schema.parse({ version: 2, ...payload });
};
