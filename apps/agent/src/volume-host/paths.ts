import { VOLUME_MOUNT_BASE } from "./constants";
import type { Volume } from "@zerobyte/contracts/volumes";

export const getVolumePath = (volume: Volume) => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};
