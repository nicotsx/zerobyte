import { VOLUME_MOUNT_BASE } from "../../core/constants";
import type { Volume } from "../../db/schema";
import type { PresentedVolume } from "@zerobyte/contracts/volumes";

export const getVolumePath = (volume: Volume | PresentedVolume) => {
	if (volume.sourceKind === "agent-filesystem") {
		return volume.relativePath ? `/${volume.relativePath}` : "/";
	}
	if (volume.config?.backend === "directory") {
		return volume.config.path;
	}

	return `${VOLUME_MOUNT_BASE}/${volume.shortId}/_data`;
};
