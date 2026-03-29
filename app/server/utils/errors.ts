import { HttpError } from "http-errors-enhanced";
import { sanitizeSensitiveData } from "@zerobyte/core/node";
import { ResticError } from "@zerobyte/core/restic";
import { toErrorDetails as getErrorDetails, toMessage as getMessage } from "@zerobyte/core/utils";

export const handleServiceError = (error: unknown) => {
	if (error instanceof HttpError) {
		return { message: sanitizeSensitiveData(error.message), status: error.statusCode };
	}

	if (error instanceof ResticError) {
		return {
			message: sanitizeSensitiveData(error.summary),
			details: error.details ? sanitizeSensitiveData(error.details) : undefined,
			status: 500 as const,
		};
	}

	return { message: sanitizeSensitiveData(toMessage(error)), status: 500 as const };
};

export const toMessage = (err: unknown): string => {
	return sanitizeSensitiveData(getMessage(err));
};

export const toErrorDetails = (err: unknown): string => {
	return sanitizeSensitiveData(getErrorDetails(err));
};
