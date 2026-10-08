import { VOLUME_MOUNT_BASE } from "../../core/constants";
import * as path from "node:path";
import {
	normalizeTrustedSourceRelativePath,
	getLocalFilesystemRootId,
	type FilesystemSource,
	type Volume,
	type PresentedVolume,
} from "@zerobyte/contracts/volumes";

export const getVolumePath = (
	volume: Pick<Volume | PresentedVolume, "sourceKind" | "config" | "relativePath" | "shortId">,
) => {
	if (volume.sourceKind === "agent-filesystem") {
		return volume.relativePath ? `/${volume.relativePath}` : "/";
	}
	if (volume.config?.backend === "directory") {
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
