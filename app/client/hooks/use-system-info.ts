import { useQuery } from "@tanstack/react-query";
import { getSystemInfoOptions } from "../api-client/@tanstack/react-query.gen";

export function useSystemInfo() {
	const { data, isLoading, error } = useQuery({
		...getSystemInfoOptions(),
		staleTime: 5 * 60 * 1000,
		gcTime: 10 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	return {
		capabilities: data?.capabilities ?? { rclone: false, sysAdmin: false },
		isLoading,
		error,
		systemInfo: data,
	};
}
