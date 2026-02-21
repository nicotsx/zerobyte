export const normalizeAbsolutePath = (value?: string): string => {
	const trimmed = value?.trim();
	if (!trimmed) return "/";

	let normalizedInput: string;
	try {
		normalizedInput = decodeURIComponent(trimmed).replace(/\\+/g, "/");
	} catch {
		normalizedInput = trimmed.replace(/\\+/g, "/");
	}
	const withLeadingSlash = normalizedInput.startsWith("/") ? normalizedInput : `/${normalizedInput}`;

	const parts = withLeadingSlash.split("/");
	const stack: string[] = [];

	for (const part of parts) {
		if (part === "" || part === ".") {
			continue;
		}
		if (part === "..") {
			if (stack.length > 0) {
				stack.pop();
			}
		} else {
			stack.push(part);
		}
	}

	let normalized = "/" + stack.join("/");

	if (!normalized || normalized === "." || normalized.startsWith("..")) {
		return "/";
	}

	const withoutTrailingSlash = normalized.replace(/\/+$/, "");
	if (!withoutTrailingSlash) {
		return "/";
	}

	const withSingleLeadingSlash = withoutTrailingSlash.startsWith("/")
		? `/${withoutTrailingSlash.replace(/^\/+/, "")}`
		: `/${withoutTrailingSlash}`;

	return withSingleLeadingSlash || "/";
};
