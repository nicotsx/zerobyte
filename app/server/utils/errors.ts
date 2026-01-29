import { HttpError } from "http-errors-enhanced";
import { sanitizeSensitiveData } from "./sanitize";

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

const resticErrorCodes: Record<number, string> = {
	1: "Command failed: An error occurred while executing the command.",
	2: "Go runtime error: A runtime error occurred in the Go program.",
	3: "Backup could not read all files: Some files could not be read during backup.",
	10: "Repository not found: The specified repository could not be found.",
	11: "Failed to lock repository: Unable to acquire a lock on the repository. Try to run doctor on the repository.",
	12: "Wrong repository password: The provided password for the repository is incorrect.",
	130: "Backup interrupted: The backup process was interrupted.",
};

export class ResticError extends Error {
	code: number;

	constructor(code: number, stderr: string) {
		const message = resticErrorCodes[code] || `Unknown restic error with code ${code}`;
		super(`${message}\n${stderr}`);

		this.code = code;
		this.name = "ResticError";
	}
}
