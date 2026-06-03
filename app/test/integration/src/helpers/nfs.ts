import type { BackendConfig } from "@zerobyte/contracts/volumes";

export const NFS_HOST = "nfs";
export const NFS_PORT = 2049;
export const NFS_EXPORT_PATH = "/";

export const buildNfsVolumeConfig = (): BackendConfig => ({
	backend: "nfs",
	server: NFS_HOST,
	exportPath: NFS_EXPORT_PATH,
	port: NFS_PORT,
	version: "4.1",
	readOnly: true,
});
