import type { BackendConfig, BackendStatus } from "~/schemas/volumes";
import type { Volume } from "../../db/schema";
import { cryptoUtils } from "../../utils/crypto";
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

const getBackendFactory = (backendType: BackendConfig["backend"]) => {
	switch (backendType) {
		case "nfs":
			return makeNfsBackend;
		case "smb":
			return makeSmbBackend;
		case "directory":
			return makeDirectoryBackend;
		case "webdav":
			return makeWebdavBackend;
		case "rclone":
			return makeRcloneBackend;
		case "sftp":
			return makeSftpBackend;
	}
};

export const createVolumeBackend = (volume: Volume): VolumeBackend => {
	const path = getVolumePath(volume);
	const makeBackend = getBackendFactory(volume.config.backend);

	return {
		mount: async () => {
			const resolvedConfig = await cryptoUtils.resolveSecretsDeep(volume.config);
			return makeBackend(resolvedConfig, path).mount();
		},
		unmount: () => makeBackend(volume.config, path).unmount(),
		checkHealth: () => makeBackend(volume.config, path).checkHealth(),
	};
};
