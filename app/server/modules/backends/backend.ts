import type { BackendStatus } from "~/schemas/volumes";
import type { Volume } from "../../db/schema";
import { getVolumePath } from "../volumes/helpers";
import { makeDirectoryBackend } from "./directory/directory-backend";
import { makeNfsBackend } from "./nfs/nfs-backend";
import { makeRcloneBackend } from "./rclone/rclone-backend";
import { makeSmbBackend } from "./smb/smb-backend";
import { makeWebdavBackend } from "./webdav/webdav-backend";
import { makeSftpBackend } from "./sftp/sftp-backend";

type OperationResult = {
	error?: string;
	status: BackendStatus;
};

export type VolumeBackend = {
	mount: () => Promise<OperationResult>;
	unmount: () => Promise<OperationResult>;
	checkHealth: () => Promise<OperationResult>;
};

export const createVolumeBackend = (volume: Volume): VolumeBackend => {
	const path = getVolumePath(volume);

	switch (volume.config.backend) {
		case "nfs": {
			return makeNfsBackend(volume.config, path);
		}
		case "smb": {
			return makeSmbBackend(volume.config, path);
		}
		case "directory": {
			return makeDirectoryBackend(volume.config, path);
		}
		case "webdav": {
			return makeWebdavBackend(volume.config, path);
		}
		case "rclone": {
			return makeRcloneBackend(volume.config, path);
		}
		case "sftp": {
			return makeSftpBackend(volume.config, path);
		}
	}
};
