export const isNodeJSErrnoException = (error: unknown): error is NodeJS.ErrnoException => {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as NodeJS.ErrnoException).code === "string"
	);
};
