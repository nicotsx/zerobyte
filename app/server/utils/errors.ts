import { HttpError } from "http-errors-enhanced";
import { sanitizeSensitiveData } from "@zerobyte/core/node";
import { ResticError } from "@zerobyte/core/restic";
import { toErrorDetails as getErrorDetails, toMessage as getMessage } from "@zerobyte/core/utils";

const formatAllowedHostsMessage = (message: string) => {
	const referencesAllowedHosts = /\ballowed\s+hosts?\b|\ballowedHosts\b/i.test(message);
	const referencesBaseUrlResolution = /\bbase\s*url\b|\bhost\b|\bfallback\s+URL\b/i.test(message);

	if (!referencesAllowedHosts || !referencesBaseUrlResolution) {
		return message;
	}

	const requestedHost = message.match(/\bHost\s+"([^"]+)"/i)?.[1];
	const configuredHosts = message.match(/\bAllowed\s+hosts:\s*(.*?)(?:\.\s+Add\b|$)/i)?.[1]?.trim();
	const hostDetails = [
		requestedHost ? `Requested host: ${requestedHost}.` : undefined,
		configuredHosts ? `Configured BASE_URL/TRUSTED_ORIGINS hosts: ${configuredHosts}.` : undefined,
	].filter(Boolean);

	return [
		"Could not resolve the auth base URL from this request.",
		...hostDetails,
		"Set BASE_URL to the URL you use to access Zerobyte, or add this origin to TRUSTED_ORIGINS.",
	].join(" ");
};

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

	return { message: formatAllowedHostsMessage(sanitizeSensitiveData(toMessage(error))), status: 500 as const };
};

export const toMessage = (err: unknown): string => {
	return sanitizeSensitiveData(getMessage(err));
};

export const toErrorDetails = (err: unknown): string => {
	return sanitizeSensitiveData(getErrorDetails(err));
};
