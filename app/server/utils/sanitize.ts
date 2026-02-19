/**
 * Sanitizes sensitive information from strings
 * This removes passwords and credentials from logs and error messages
 */
export const sanitizeSensitiveData = (text: string): string => {
	if (process.env.NODE_ENV === "development") {
		return text;
	}

	let sanitized = text.replace(/\b(pass|password)=([^\s,]+)/gi, "$1=***");

	sanitized = sanitized.replace(/\/\/([^:@\s]+):([^@\s]+)@/g, "//$1:***@");

	sanitized = sanitized.replace(/(\S+)\s+(\S+)\s+(\S+)/g, (match, url, user, _pass) => {
		if (url.startsWith("http://") || url.startsWith("https://")) {
			return `${url} ${user} ***`;
		}
		return match;
	});

	return sanitized;
};

/**
 * Sanitizes a filename for use in HTTP Content-Disposition header
 * Removes control characters and replaces special characters to prevent header injection
 */
export const sanitizeContentDispositionFilename = (filename: string): string => {
	const sanitized = filename
		.replace(/[\r\n]/g, "")
		.replace(/["\\]/g, "_")
		.trim();
	return sanitized || "snapshot.tar";
};
