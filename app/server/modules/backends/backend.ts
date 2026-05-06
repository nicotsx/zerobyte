import { makeDirectoryBackend } from "../../../../apps/agent/src/volume-host/backends/directory";
import { makeNfsBackend } from "../../../../apps/agent/src/volume-host/backends/nfs";
import { makeRcloneBackend } from "../../../../apps/agent/src/volume-host/backends/rclone";
import { makeSftpBackend } from "../../../../apps/agent/src/volume-host/backends/sftp";
import { makeSmbBackend } from "../../../../apps/agent/src/volume-host/backends/smb";
import { makeWebdavBackend } from "../../../../apps/agent/src/volume-host/backends/webdav";
import type { VolumeBackend } from "../../../../apps/agent/src/volume-host/types";
import type { Volume } from "../../db/schema";
import { getVolumePath } from "../volumes/helpers";

export type { VolumeBackend };

export const createVolumeBackend = (volume: Volume, mountPath = getVolumePath(volume)): VolumeBackend => {
	switch (volume.config.backend) {
		case "nfs": {
			return makeNfsBackend(volume.config, mountPath);
		}
		case "smb": {
			return makeSmbBackend(volume.config, mountPath);
		}
		case "directory": {
			return makeDirectoryBackend(volume.config, mountPath);
		}
		case "webdav": {
			return makeWebdavBackend(volume.config, mountPath);
		}
		case "rclone": {
			return makeRcloneBackend(volume.config, mountPath);
		}
		case "sftp": {
			return makeSftpBackend(volume.config, mountPath);
		}
		default: {
			throw new Error("Unsupported backend");
		}
	}
};
