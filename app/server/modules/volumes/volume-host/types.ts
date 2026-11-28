import type { VolumeOperationResult } from "@zerobyte/contracts/volumes";

export type VolumeBackendResult = VolumeOperationResult & { inconclusive?: true };

export type VolumeBackend = {
	mount: () => Promise<VolumeBackendResult>;
	unmount: () => Promise<VolumeBackendResult>;
	checkHealth: () => Promise<VolumeBackendResult>;
};
