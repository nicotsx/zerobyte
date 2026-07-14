import type { ConfigTransferPayloadV1 } from "./v1/payload";

export type ConfigTransferModel = Omit<ConfigTransferPayloadV1, "version">;
