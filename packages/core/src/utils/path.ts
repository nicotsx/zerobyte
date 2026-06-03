export const normalizeAbsolutePath = (value?: string): string => {
	if (!value?.trim()) return "/";

	let normalizedInput: string;
	try {
		normalizedInput = decodeURIComponent(value).replace(/\\+/g, "/");
	} catch {
		normalizedInput = value.replace(/\\+/g, "/");
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

	if (normalized.length > 1000) {
		throw new Error("Normalized path is too long");
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

export const isPathWithin = (base: string, target: string): boolean => {
	const normalizedBase = normalizeAbsolutePath(base);
	const normalizedTarget = normalizeAbsolutePath(target);

	return (
		normalizedBase === "/" ||
		normalizedTarget === normalizedBase ||
		normalizedTarget.startsWith(`${normalizedBase}/`)
	);
};

export const hasPathListSeparator = (value: string, format: "raw" | "text") =>
	value.includes("\u0000") || (format === "text" && (value.includes("\n") || value.includes("\r")));
