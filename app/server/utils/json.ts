export function safeJsonParse<T>(input: string | null | undefined): T | null {
	if (!input) {
		return null;
	}

	try {
		return JSON.parse(input) as T;
	} catch {
		return null;
	}
}
