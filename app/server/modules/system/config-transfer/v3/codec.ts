import { configTransferPayloadV3Schema, type ConfigTransferPayloadV3 } from "./payload";
import type { ConfigTransferModelV3 } from "./model";

export const decodeConfigTransferPayloadV3 = ({
	version: _version,
	...payload
}: ConfigTransferPayloadV3): ConfigTransferModelV3 => {
	return payload;
};

export const encodeConfigTransferPayloadV3 = (payload: ConfigTransferModelV3): ConfigTransferPayloadV3 => {
	return configTransferPayloadV3Schema.parse({ version: 3, ...payload });
};
