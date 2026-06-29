export const isWindowsHostPath = (value: string): boolean => /^[A-Za-z]:(?:[\\/]|$)/.test(value);

export const normalizeWindowsHostPath = (value: string): string | undefined => {
	if (!isWindowsHostPath(value)) return undefined;

	const parts: string[] = [];
	for (const part of value.slice(2).replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			parts.pop();
			continue;
		}
		parts.push(part);
	}

	return `${value[0]?.toUpperCase()}:\\${parts.join("\\")}`;
};

export const windowsHostPathToResticSnapshotPath = (value: string): string | undefined => {
	const normalized = normalizeWindowsHostPath(value);
	if (!normalized) return undefined;

	const withoutDrive = normalized
		.slice(2)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	return withoutDrive ? `/${normalized[0]}/${withoutDrive}` : `/${normalized[0]}`;
};

export const windowsResticSnapshotPathToHostPath = (value: string): string | undefined => {
	const match = /^\/([A-Za-z])(?:\/(.*))?$/.exec(value);
	if (!match?.[1]) return undefined;

	const segments = match[2]?.split("/").filter(Boolean) ?? [];
	return `${match[1].toUpperCase()}:\\${segments.join("\\")}`;
};

export const findWindowsHostCommonAncestor = (paths: string[]): string | undefined => {
	const normalizedPaths: string[] = [];
	for (const path of paths) {
		const normalizedPath = normalizeWindowsHostPath(path);
		if (!normalizedPath) return undefined;
		normalizedPaths.push(normalizedPath);
	}

	const drive = normalizedPaths[0]?.slice(0, 2);
	if (
		!drive ||
		normalizedPaths.some((normalizedPath) => normalizedPath.slice(0, 2).toLowerCase() !== drive.toLowerCase())
	) {
		return undefined;
	}

	const splitPaths = normalizedPaths.map((normalizedPath) => normalizedPath.slice(3).split("\\").filter(Boolean));
	const minLength = Math.min(...splitPaths.map((parts) => parts.length));

	const commonParts: string[] = [];
	for (let i = 0; i < minLength; i++) {
		const firstPart = splitPaths[0]?.[i];
		if (!firstPart) break;

		if (splitPaths.every((parts) => parts[i]?.toLowerCase() === firstPart.toLowerCase())) {
			commonParts.push(firstPart);
		} else {
			break;
		}
	}

	return `${drive.toUpperCase()}\\${commonParts.join("\\")}`;
};

export const getWindowsHostParentPath = (value: string): string | undefined => {
	const normalized = normalizeWindowsHostPath(value);
	if (!normalized) return undefined;

	const driveRoot = `${normalized.slice(0, 2)}\\`;
	const withoutTrailingSlash = normalized.replace(/\\+$/, "");
	const lastSlashIndex = withoutTrailingSlash.lastIndexOf("\\");

	if (lastSlashIndex <= 2) {
		return driveRoot;
	}

	return withoutTrailingSlash.slice(0, lastSlashIndex);
};

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
