import { makeDirectoryBackend } from "./backends/directory";
import { makeNfsBackend } from "./backends/nfs";
import { makeRcloneBackend } from "./backends/rclone";
import { makeSftpBackend } from "./backends/sftp";
import { makeSmbBackend } from "./backends/smb";
import { makeWebdavBackend } from "./backends/webdav";
import { getVolumePath } from "./paths";
import type { AgentVolume, VolumeBackend } from "./types";

export { getStatFs, isNodeJSErrnoException } from "./fs";
export { getVolumePath } from "./paths";
export type { AgentVolume, BackendConfig, VolumeBackend } from "./types";

export const createVolumeBackend = (volume: AgentVolume, mountPath = getVolumePath(volume)): VolumeBackend => {
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
	}

	throw new Error("Unsupported backend");
};
