import { useQuery } from "@tanstack/react-query";
import { listSourceMachinesOptions } from "~/client/api-client/@tanstack/react-query.gen";
import type { SourceDiscovery } from "../components/agent-filesystem-source-form";

export function useSourceDiscovery(enabled: boolean) {
	const sourceMachinesOptions = listSourceMachinesOptions();
	const sourceMachinesQueryOptions = { ...sourceMachinesOptions, enabled };
	const sourceMachinesQuery = useQuery(sourceMachinesQueryOptions);

	const isReady = enabled && sourceMachinesQuery.isSuccess && !sourceMachinesQuery.isError;
	const failed = enabled && sourceMachinesQuery.isError;
	const sourceMachines = sourceMachinesQuery.data ?? [];

	const retry = () => {
		void sourceMachinesQuery.refetch();
	};

	let sourceDiscovery: SourceDiscovery = { status: "loading" };

	if (failed) sourceDiscovery = { status: "error", retry };
	else if (isReady) sourceDiscovery = { status: "ready", machines: sourceMachines };

	return { isReady, sourceDiscovery };
}
