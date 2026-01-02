import crypto from "node:crypto";

const SHORT_ID_LENGTH = 8;

export const generateShortId = (length = SHORT_ID_LENGTH): string => {
	const bytesNeeded = Math.ceil((length * 3) / 4);
	return crypto.randomBytes(bytesNeeded).toString("base64url").slice(0, length);
};

export const isValidShortId = (value: string, length = SHORT_ID_LENGTH): boolean => {
	const regex = new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
	return regex.test(value);
};
