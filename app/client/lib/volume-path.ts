import type { Volume } from "./types";

const VOLUME_MOUNT_BASE = "/var/lib/zerobyte/volumes";

export const getVolumeMountPath = (volume: Volume): string => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};

/**
 * Converts between the full paths a snapshot stores (rooted at whatever the
 * backup source was, e.g. `/home/billy/code/foo`) and the paths shown in the
 * UI (rooted at the volume, e.g. `/code/foo`) — so what a user sees matches
 * the volume they configured, not the host filesystem layout behind it.
 */
export function createPathPrefixFns(basePath: string) {
	return {
		strip(path: string) {
			if (basePath === "/") return path;
			if (path === basePath) return "/";
			if (path.startsWith(`${basePath}/`)) return path.slice(basePath.length);
			return path;
		},
		add(displayPath: string) {
			if (basePath === "/") return displayPath;
			if (displayPath === "/") return basePath;
			return `${basePath}${displayPath}`;
		},
	};
}
