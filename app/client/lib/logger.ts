const PREFIX = "[APP]";

export const logger = {
	error: (...args: unknown[]) => console.error(PREFIX, ...args),
	warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
	info: (...args: unknown[]) => console.info(PREFIX, ...args),
};
