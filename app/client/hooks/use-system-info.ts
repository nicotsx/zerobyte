import { useQuery } from "@tanstack/react-query";
import { getSystemInfoOptions } from "../api-client/@tanstack/react-query.gen";
import type { BackendType } from "@zerobyte/contracts/volumes";
import type { RepositoryBackend } from "@zerobyte/core/restic";

type SystemInfo = {
	runtime: "server" | "desktop";
	capabilities: {
		rclone: boolean;
		sysAdmin: boolean;
		volumeBackends: BackendType[];
		repositoryBackends: RepositoryBackend[];
	};
};

const defaultSystemInfo: SystemInfo = {
	runtime: "server",
	capabilities: {
		rclone: false,
		sysAdmin: false,
		volumeBackends: ["directory"],
		repositoryBackends: ["local", "s3", "r2", "gcs", "azure", "sftp", "rest"],
	},
};

export function useSystemInfo() {
	const { data, isLoading, error } = useQuery({
		...getSystemInfoOptions(),
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
	});
	const systemInfo = data ?? defaultSystemInfo;

	return {
		runtime: systemInfo.runtime,
		capabilities: systemInfo.capabilities,
		isLoading,
		error,
		systemInfo,
	};
}
