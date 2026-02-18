import type { Volume } from "./types";

const VOLUME_MOUNT_BASE = "/var/lib/zerobyte/volumes";

export const getVolumeMountPath = (volume: Volume): string => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};
