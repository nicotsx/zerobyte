import type { VolumeOperationResult } from "@zerobyte/contracts/volumes";

export type VolumeBackend = {
	mount: () => Promise<VolumeOperationResult>;
	unmount: () => Promise<VolumeOperationResult>;
	checkHealth: () => Promise<VolumeOperationResult>;
};
