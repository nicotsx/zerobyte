import { z } from "zod";
import { CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH, CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH } from "~/lib/config-transfer";

export const configTransferPassphraseSchema = z
	.string()
	.min(CONFIG_TRANSFER_PASSPHRASE_MIN_LENGTH)
	.max(CONFIG_TRANSFER_PASSPHRASE_MAX_LENGTH);
