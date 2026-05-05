import { VOLUME_MOUNT_BASE } from "./constants";
import type { AgentVolume } from "./types";

export const getVolumePath = (volume: AgentVolume) => {
	if (volume.config.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};
