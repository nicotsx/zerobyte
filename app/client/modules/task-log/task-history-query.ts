import { queryOptions } from "@tanstack/react-query";
import { listTaskHistory } from "~/client/api-client/sdk.gen";
import type { TaskHistoryOutcome } from "~/schemas/task-history";
import type { TaskKind } from "~/schemas/tasks";

type TaskHistoryQueryParams = {
	organizationId: string;
	kind?: TaskKind;
	outcome?: TaskHistoryOutcome;
	page: number;
};

export function taskHistoryQueryOptions(params: TaskHistoryQueryParams) {
	const query = { kind: params.kind, outcome: params.outcome, page: params.page };
	const queryKey = ["task-history", params.organizationId, query] as const;

	return queryOptions({
		queryKey,
		queryFn: async ({ signal }) => {
			const response = await listTaskHistory({ query, signal, throwOnError: true });
			const history = response.data;

			if (history.organizationId !== params.organizationId) {
				throw new Error("The active organization changed while task history was loading");
			}

			return history;
		},
	});
}
