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
	summary: string;
	details: string;

	constructor(code: number, details: string) {
		const summary = resticErrorCodes[code] || `Unknown restic error with code ${code}`;
		super(details ? `${summary}\n${details}` : summary);

		this.code = code;
		this.summary = summary;
		this.details = details;
		this.name = "ResticError";
	}
}
