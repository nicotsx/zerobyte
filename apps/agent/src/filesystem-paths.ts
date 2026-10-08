import * as path from "node:path";
import { toErrorDetails } from "@zerobyte/core/utils";

export const relativeFilesystemPath = (basePath: string, absolutePath: string) => {
	const relativePath = path.relative(basePath, absolutePath);
	if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
		return "[outside source]";
	}

	return relativePath.split(path.sep).join("/");
};

export const reportSourceError = (
	error: unknown,
	fallbackMessage = "The agent could not complete the filesystem operation. Check the agent logs for details.",
) => {
	const details = toErrorDetails(error);
	console.error(details);

	// Keep the permission code needed by the desktop UI, without exposing host paths.
	const permissionCode = details.match(/\b(EPERM|EACCES)\b/)?.[1];
	if (permissionCode) return `${permissionCode}: Access to this folder was denied.`;

	return fallbackMessage;
};
