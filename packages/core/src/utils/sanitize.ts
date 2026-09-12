/**
 * Sanitizes sensitive information from strings
 * This removes passwords and credentials from logs and error messages
 */
export const sanitizeSensitiveData = (text: string): string => {
	if (process.env.NODE_ENV === "development") {
		return text;
	}

	let sanitized = text.replace(/\b(pass|password)=((?:\\.|[^\s,])*)/gi, "$1=***");

	sanitized = sanitized.replace(/\/\/([^:@\s]+):([^@\s]+)@/g, "//$1:***@");

	return sanitized;
};
