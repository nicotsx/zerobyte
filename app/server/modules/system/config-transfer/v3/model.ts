import type { ConfigTransferPayloadV3 } from "./payload";

export type ConfigTransferModelV3 = Omit<ConfigTransferPayloadV3, "version">;
