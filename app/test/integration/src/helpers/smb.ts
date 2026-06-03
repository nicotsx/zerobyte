import type { BackendConfig } from "@zerobyte/contracts/volumes";

export const SMB_HOST = "smb";
export const SMB_PORT = 445;
export const SMB_SHARE = "zerobyte-integration";
export const SMB_USERNAME = "zerobyte-smb";
export const SMB_PASSWORD = "zerobyte-smb-password";

export const buildSmbVolumeConfig = (): BackendConfig => ({
	backend: "smb",
	server: SMB_HOST,
	share: SMB_SHARE,
	username: SMB_USERNAME,
	password: SMB_PASSWORD,
	mapToContainerUidGid: false,
	vers: "3.0",
	port: SMB_PORT,
	readOnly: true,
});
