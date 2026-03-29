import { ResticError } from "../restic/error.js";

export const toMessage = (error: unknown) => {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
};

export const toErrorDetails = (error: unknown) => {
	if (error instanceof ResticError) {
		return error.details || error.summary;
	}

	return toMessage(error);
};
