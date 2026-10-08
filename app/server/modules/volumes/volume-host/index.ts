import { makeDirectoryBackend } from "./backends/directory";
import { makeNfsBackend } from "./backends/nfs";
import { makeRcloneBackend } from "./backends/rclone";
import { makeSftpBackend } from "./backends/sftp";
import { makeSmbBackend } from "./backends/smb";
import { makeWebdavBackend } from "./backends/webdav";
import { getVolumePath } from "../helpers";
import type { Volume } from "@zerobyte/contracts/volumes";
import type { VolumeBackend } from "./types";

export const createVolumeBackend = (volume: Volume, mountPath = getVolumePath(volume)): VolumeBackend => {
	if (volume.sourceKind === "agent-filesystem" || !volume.config) {
		throw new Error("Managed volume configuration is missing");
	}

	switch (volume.config.backend) {
		case "directory":
			return makeDirectoryBackend(volume.config, mountPath);
		case "nfs":
			return makeNfsBackend(volume.config, mountPath);
		case "smb":
			return makeSmbBackend(volume.config, mountPath);
		case "webdav":
			return makeWebdavBackend(volume.config, mountPath);
		case "rclone":
			return makeRcloneBackend(volume.config, mountPath);
		case "sftp":
			return makeSftpBackend(volume.config, mountPath);
		default: {
			const _exhaustive: never = volume.config;
			throw new Error("Unsupported backend");
		}
	}
};
