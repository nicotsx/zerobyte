import crypto from "node:crypto";
import type { ShortId } from "./branded";

export const generateShortId = (length = 8): ShortId => {
	const bytesNeeded = Math.ceil((length * 3) / 4);
	return crypto.randomBytes(bytesNeeded).toString("base64url").slice(0, length) as ShortId;
};
