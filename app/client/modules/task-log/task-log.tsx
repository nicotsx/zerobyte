import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { ListTaskHistoryResponse } from "~/client/api-client";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { isTaskActive } from "~/client/hooks/use-active-tasks";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import { taskHistoryOutcomes, type TaskHistoryLifecycleItem } from "~/schemas/task-history";
import { taskKinds } from "~/schemas/tasks";
import { TaskDetailsDialog } from "./components/task-details-dialog";
import { getTaskLogPagination } from "./components/task-log-pagination";
import { TaskLogResults } from "./components/task-log-results";
import {
	taskLogKindLabels,
	taskLogOutcomeLabels,
	type TaskLogKind,
	type TaskLogOutcome,
} from "./components/task-log-shared";
import { useLiveClock } from "./hooks/use-live-clock";
import { useTaskLogLiveUpdates } from "./hooks/use-task-log-live-updates";
import { taskHistoryQueryOptions } from "./task-history-query";

export { getTaskLogPagination };
export type { TaskLogKind, TaskLogOutcome };

type Props = {
	initialData?: ListTaskHistoryResponse;
	organizationId: string;
	kind?: TaskLogKind;
	outcome?: TaskLogOutcome;
	page: number;
	onKindChange: (kind: TaskLogKind | undefined) => void;
	onOutcomeChange: (outcome: TaskLogOutcome | undefined) => void;
	onPageChange: (page: number) => void;
};

const kindOptions = taskKinds.map((value) => ({
	value,
	label: taskLogKindLabels[value],
}));

const outcomeOptions = taskHistoryOutcomes.map((value) => ({
	value,
	label: taskLogOutcomeLabels[value],
}));

export function TaskLogPage(props: Props) {
	const componentKey = `${props.organizationId}:${props.kind ?? "all"}:${props.outcome ?? "all"}`;

	return <TaskLogPageContent key={componentKey} {...props} />;
}

function TaskLogPageContent({
	initialData,
	organizationId,
	kind,
	outcome,
	page,
	onKindChange,
	onOutcomeChange,
	onPageChange,
}: Props) {
	const { formatDateTimeWithSeconds } = useTimeFormat();
	const queryClient = useQueryClient();
	const [selection, setSelection] = useState<string | null>(null);

	const historyQuery = useMemo(
		() => taskHistoryQueryOptions({ organizationId, kind, outcome, page }),
		[kind, organizationId, outcome, page],
	);
	const initialDataMatchesOrganization = initialData?.organizationId === organizationId;
	const queryInitialData = initialDataMatchesOrganization ? initialData : undefined;
	const history = useQuery({
		...historyQuery,
		gcTime: 0,
		initialData: queryInitialData,
		staleTime: "static",
	});

	const items = history.data?.items ?? [];
	const selectedTask = items.find((item) => item.id === selection) ?? null;
	const now = useLiveClock(items.some(isTaskActive));

	const updateTask = useCallback(
		(item: TaskHistoryLifecycleItem) => {
			queryClient.setQueryData<ListTaskHistoryResponse>(historyQuery.queryKey, (currentHistory) => {
				if (!currentHistory) {
					return currentHistory;
				}

				const itemIndex = currentHistory.items.findIndex((currentItem) => currentItem.id === item.id);
				if (itemIndex === -1) {
					return currentHistory;
				}

				const items = [...currentHistory.items];
				items[itemIndex] = { ...items[itemIndex], ...item };
				return { ...currentHistory, items };
			});
		},
		[historyQuery.queryKey, queryClient],
	);

	useTaskLogLiveUpdates({
		organizationId,
		kind,
		outcome,
		page,
		refresh: history.refetch,
		updateTask,
	});

	const showLatest = useCallback(() => {
		setSelection(null);
		onPageChange(1);
	}, [onPageChange]);

	useEffect(() => {
		if (!history.data) return;
		const lastPage = Math.max(1, history.data.totalPages);
		if (page > lastPage) onPageChange(lastPage);
	}, [history.data, onPageChange, page]);

	useEffect(() => {
		setSelection(null);
	}, [page]);

	const refresh = async () => {
		const result = await history.refetch();
		if (result.isError) {
			toast.error("Failed to refresh activity", { description: result.error.message });
			return;
		}

		toast.success("Activity refreshed");
	};

	return (
		<div className="flex flex-col gap-4">
			<Card className="gap-0 overflow p-0">
				<div className="flex flex-col gap-3 border-b bg-card-header p-4 md:flex-row md:items-center md:justify-between">
					<div className="flex flex-col gap-2 sm:flex-row">
						<Select
							value={kind ?? "all"}
							onValueChange={(value) =>
								onKindChange(value === "all" ? undefined : (value as TaskLogKind))
							}
						>
							<SelectTrigger aria-label="Task type" className="w-full sm:w-52">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All task types</SelectItem>
								{kindOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={outcome ?? "all"}
							onValueChange={(value) =>
								onOutcomeChange(value === "all" ? undefined : (value as TaskLogOutcome))
							}
						>
							<SelectTrigger aria-label="Outcome" className="w-full sm:w-44">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All outcomes</SelectItem>
								{outcomeOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-center gap-2">
						{page > 1 && (
							<Button variant="outline" size="sm" onClick={showLatest}>
								<CircleAlert className="mr-2 h-4 w-4" />
								View latest activity
							</Button>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="icon"
									aria-label="Refresh activity"
									onClick={() => void refresh()}
									disabled={history.isFetching}
								>
									<RefreshCw className={cn({ "animate-spin": history.isFetching })} />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Refresh activity</TooltipContent>
						</Tooltip>
					</div>
				</div>

				<TaskLogResults
					history={history.data}
					isPending={history.isPending}
					kind={kind}
					outcome={outcome}
					page={page}
					now={now}
					formatDateTimeWithSeconds={formatDateTimeWithSeconds}
					onRetry={() => void history.refetch()}
					onPageChange={onPageChange}
					onSelectTask={setSelection}
				/>
			</Card>

			<TaskDetailsDialog task={selectedTask} now={now} onOpenChange={(open) => !open && setSelection(null)} />
		</div>
	);
}
