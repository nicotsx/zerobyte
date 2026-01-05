import { useQuery } from "@tanstack/react-query";
import { getUpdatesOptions } from "../api-client/@tanstack/react-query.gen";

export function useUpdates() {
	const { data, isLoading, error } = useQuery({
		...getUpdatesOptions(),
		staleTime: 60 * 60 * 1000,
		gcTime: 24 * 60 * 60 * 1000,
		refetchOnWindowFocus: false,
	});

	return {
		updates: data,
		hasUpdate: data?.hasUpdate ?? false,
		isLoading,
		error,
	};
}
