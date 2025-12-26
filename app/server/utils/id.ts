import crypto from "node:crypto";

export const generateShortId = (length = 8): string => {
	const bytesNeeded = Math.ceil((length * 3) / 4);
	return crypto.randomBytes(bytesNeeded).toString("base64url").slice(0, length);
};
