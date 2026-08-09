import { useCallback, useEffect } from "react";
import { useServerEvents } from "~/client/hooks/use-server-events";
import type { ServerEventPayloadMap } from "~/schemas/server-events";
import type { TaskHistoryLifecycleItem } from "~/schemas/task-history";
import type { TaskLogKind, TaskLogOutcome } from "../components/task-log-shared";

type UseTaskLogLiveUpdatesParams = {
	organizationId: string;
	kind?: TaskLogKind;
	outcome?: TaskLogOutcome;
	page: number;
	refresh: () => Promise<unknown>;
	updateTask: (item: TaskHistoryLifecycleItem) => void;
};

const matchesTaskLogFilter = (
	event: ServerEventPayloadMap["task:history-changed"],
	organizationId: string,
	kind: TaskLogKind | undefined,
	outcome: TaskLogOutcome | undefined,
) => {
	if (event.organizationId !== organizationId) {
		return false;
	}

	if (kind && event.item.kind !== kind) {
		return false;
	}

	if (!outcome) {
		return true;
	}

	return event.previousOutcome === outcome || event.item.outcome === outcome;
};

export const useTaskLogLiveUpdates = ({
	organizationId,
	kind,
	outcome,
	page,
	refresh,
	updateTask,
}: UseTaskLogLiveUpdatesParams) => {
	const { addEventListener } = useServerEvents();

	const handleTaskHistoryChange = useCallback(
		(event: ServerEventPayloadMap["task:history-changed"]) => {
			const matchesFilter = matchesTaskLogFilter(event, organizationId, kind, outcome);
			if (!matchesFilter) {
				return;
			}

			if (page === 1) {
				void refresh();
				return;
			}

			updateTask(event.item);
		},
		[kind, organizationId, outcome, page, refresh, updateTask],
	);
	const handleConnected = useCallback(() => {
		if (page === 1) {
			void refresh();
		}
	}, [page, refresh]);

	useEffect(() => {
		const removeTaskHistoryListener = addEventListener("task:history-changed", handleTaskHistoryChange);
		const removeConnectedListener = addEventListener("connected", handleConnected);
		if (page === 1) {
			void refresh();
		}

		return () => {
			removeTaskHistoryListener();
			removeConnectedListener();
		};
	}, [addEventListener, handleConnected, handleTaskHistoryChange, page, refresh]);
};
