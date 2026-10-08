import { VOLUME_MOUNT_BASE } from "../../core/constants";
import * as path from "node:path";
import {
	normalizeTrustedSourceRelativePath,
	getLocalFilesystemRootId,
	type FilesystemSource,
	type Volume,
} from "@zerobyte/contracts/volumes";

export const getVolumePath = (volume: Volume) => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};

export const getLocalFilesystemSource = (localPath: string): FilesystemSource => {
	const resolvedPath = path.resolve(localPath);
	const rootPath = path.parse(resolvedPath).root;

	return {
		rootId: getLocalFilesystemRootId(rootPath),
		relativePath: normalizeTrustedSourceRelativePath(
			path.relative(rootPath, resolvedPath).split(path.sep).join("/"),
		),
	};
};
