import { HttpError } from "http-errors-enhanced";
import { sanitizeSensitiveData } from "@zerobyte/core/node";
import { ResticError } from "@zerobyte/core/restic";

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
	const message = err instanceof Error ? err.message : String(err);
	return sanitizeSensitiveData(message);
};

export const toErrorDetails = (err: unknown): string => {
	if (err instanceof ResticError) {
		return sanitizeSensitiveData(err.details || err.summary);
	}

	return toMessage(err);
};
