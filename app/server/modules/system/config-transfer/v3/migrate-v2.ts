import type { ConfigTransferModelV2 } from "../v2/model";
import type { ConfigTransferModelV3 } from "./model";

export const migrateConfigTransferV2ToV3 = (payload: ConfigTransferModelV2): ConfigTransferModelV3 => ({
	...payload,
	repositories: payload.repositories.map((repository) => ({ ...repository, machineRef: null })),
});
