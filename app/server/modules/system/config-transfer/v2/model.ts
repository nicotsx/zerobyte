import type { ConfigTransferPayloadV2 } from "./payload";

export type ConfigTransferModelV2 = Omit<ConfigTransferPayloadV2, "version">;
