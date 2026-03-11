import { HttpError } from "http-errors-enhanced";
import { sanitizeSensitiveData } from "@zerobyte/core/node";

export const handleServiceError = (error: unknown) => {
	if (error instanceof HttpError) {
		return { message: sanitizeSensitiveData(error.message), status: error.statusCode };
	}

	return { message: sanitizeSensitiveData(toMessage(error)), status: 500 as const };
};

export const toMessage = (err: unknown): string => {
	const message = err instanceof Error ? err.message : String(err);
	return sanitizeSensitiveData(message);
};
