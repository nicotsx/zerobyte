import * as path from "node:path";
import type { ResticBackupProgressDto } from "@zerobyte/core/restic";
import { toErrorDetails } from "@zerobyte/core/utils";
import { encodeTrustedPathPresentation } from "@zerobyte/contracts/volumes";

export const serializeFilesystemPath = (value: string) => value.replaceAll("\\", "/");

// Arbitrary subprocess diagnostics stay on the machine that produced them.
// Only structured path fields cross the controller boundary.
export const reportSourceError = (error: unknown) => {
	console.error(toErrorDetails(error));
	return "The agent could not complete the filesystem operation. Check the agent logs for details.";
};

export const createTrustedSourcePresentation = (options: {
	configuredRootPath: string;
	canonicalRootPath: string;
	sourceRelativePath: string;
}) => {
	const rootPath = options.canonicalRootPath;
	const rootSafe = path.parse(rootPath).root === rootPath;
	const formatPath = (value: string) => {
		for (const root of [rootPath, options.configuredRootPath]) {
			const relative = path.relative(root, value);
			const escapesRoot = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
			if (escapesRoot) continue;
			const portablePath = serializeFilesystemPath(relative);
			return encodeTrustedPathPresentation(portablePath, rootSafe);
		}
		return "[outside source]";
	};
	const formatProgress = (progress: ResticBackupProgressDto): ResticBackupProgressDto => {
		const currentFiles = progress.current_files.map(formatPath);
		return { ...progress, current_files: currentFiles };
	};
	const formatBrowseResult = <Result extends { path: string; directories: Array<{ path: string }> }>(
		result: Result,
	) => {
		const directories = result.directories.map((directory) => {
			const directoryPath = encodeTrustedPathPresentation(directory.path, true);
			return { ...directory, path: directoryPath };
		});
		const browsePath = encodeTrustedPathPresentation(result.path, true);
		return { ...result, path: browsePath, directories };
	};
	const sourcePath = encodeTrustedPathPresentation(options.sourceRelativePath, rootSafe);
	return {
		sourcePath,
		browseRootPath: rootPath,
		formatError: reportSourceError,
		formatProgress,
		formatBrowseResult,
	};
};

export type TrustedSourcePresentation = ReturnType<typeof createTrustedSourcePresentation>;
