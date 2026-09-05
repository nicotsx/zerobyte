class TimeoutError extends Error {
	code = "ETIMEOUT";
	constructor(message: string) {
		super(message);
		this.name = "TimeoutError";
	}
}

export const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
};
