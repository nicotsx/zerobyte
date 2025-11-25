import { VOLUME_MOUNT_BASE } from "../../core/constants";
import type { Volume } from "../../db/schema";

export const getVolumePath = (volume: Volume) => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};
