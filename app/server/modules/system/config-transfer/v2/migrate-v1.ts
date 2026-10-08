import type { ConfigTransferModelV1 } from "../v1/model";
import type { ConfigTransferModelV2 } from "./model";

export const migrateConfigTransferV1ToV2 = (payload: ConfigTransferModelV1): ConfigTransferModelV2 => ({
	...payload,
	machines: [],
	volumes: payload.volumes.map((volume) => ({ ...volume, sourceKind: "managed", machineRef: null })),
});
