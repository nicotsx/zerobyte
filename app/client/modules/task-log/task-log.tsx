import { useQuery } from "@tanstack/react-query";
import { CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listTaskHistoryOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { skipServerEventInvalidationMeta } from "~/client/events/server-event-effects";
import { isTaskActive } from "~/client/hooks/use-active-tasks";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";
import {
	taskHistoryKindLabels,
	taskHistoryKinds,
	taskHistoryOutcomeLabels,
	taskHistoryOutcomes,
} from "~/schemas/task-history";
import { TaskDetailsDialog } from "./task-details-dialog";
import { getTaskLogPagination } from "./task-log-pagination";
import { TaskLogResults } from "./task-log-results";
import { formatTaskDuration, type TaskLogKind, type TaskLogOutcome } from "./task-log-shared";
import { useLiveClock } from "./use-live-clock";
import { useTaskLogLiveUpdates } from "./use-task-log-live-updates";

export { getTaskLogPagination, formatTaskDuration };
export type { TaskLogKind, TaskLogOutcome };

type Props = {
	kind?: TaskLogKind;
	outcome?: TaskLogOutcome;
	page: number;
	onKindChange: (kind: TaskLogKind | undefined) => void;
	onOutcomeChange: (outcome: TaskLogOutcome | undefined) => void;
	onPageChange: (page: number) => void;
};

const kindOptions = taskHistoryKinds.map((value) => ({
	value,
	label: taskHistoryKindLabels[value],
}));
const outcomeOptions = taskHistoryOutcomes.map((value) => ({
	value,
	label: taskHistoryOutcomeLabels[value],
}));

export function TaskLogPage(props: Props) {
	const filterKey = `${props.kind ?? "all"}:${props.outcome ?? "all"}`;

	return <TaskLogPageContent key={filterKey} {...props} />;
}

function TaskLogPageContent({ kind, outcome, page, onKindChange, onOutcomeChange, onPageChange }: Props) {
	const { formatDateTimeWithSeconds } = useTimeFormat();
	const viewKey = String(page);
	const [selection, setSelection] = useState<{ viewKey: string; taskId: string } | null>(null);
	const history = useQuery({
		...listTaskHistoryOptions({ query: { kind, outcome, page } }),
		meta: page > 1 ? skipServerEventInvalidationMeta : undefined,
		refetchOnReconnect: page === 1,
		refetchOnWindowFocus: page === 1,
	});
	const items = history.data?.items ?? [];
	const selectedTask =
		selection?.viewKey === viewKey ? (items.find((item) => item.id === selection.taskId) ?? null) : null;
	const now = useLiveClock(items.some(isTaskActive));
	const { newActivity, clearNewActivity } = useTaskLogLiveUpdates({
		kind,
		outcome,
		page,
		viewKey,
		history: history.data,
		refetch: history.refetch,
	});

	const showLatest = useCallback(() => {
		setSelection(null);
		clearNewActivity();
		if (page === 1) {
			void history.refetch();
			return;
		}
		onPageChange(1);
	}, [clearNewActivity, history, onPageChange, page]);

	useEffect(() => {
		if (!history.data) return;
		const lastPage = Math.max(1, history.data.totalPages);
		if (page > lastPage) onPageChange(lastPage);
	}, [history.data, onPageChange, page]);

	const refresh = async () => {
		clearNewActivity();
		await history.refetch();
	};

	return (
		<div className="flex flex-col gap-4">
			<Card className="gap-0 overflow p-0">
				<div className="flex flex-col gap-3 border-b bg-card-header p-4 lg:flex-row lg:items-center lg:justify-between">
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
						{newActivity && (
							<Button variant="outline" size="sm" onClick={showLatest}>
								<CircleAlert />
								View latest activity
							</Button>
						)}
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="icon"
									aria-label="Refresh task log"
									onClick={() => void refresh()}
									disabled={history.isFetching}
								>
									<RefreshCw className={cn({ "animate-spin": history.isFetching })} />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Refresh task log</TooltipContent>
						</Tooltip>
					</div>
				</div>

				<TaskLogResults
					history={history.data}
					isPending={history.isPending}
					isError={history.isError}
					kind={kind}
					outcome={outcome}
					page={page}
					now={now}
					formatDateTimeWithSeconds={formatDateTimeWithSeconds}
					onRetry={() => void history.refetch()}
					onPageChange={onPageChange}
					onSelectTask={(taskId) => setSelection({ viewKey, taskId })}
				/>
			</Card>

			<TaskDetailsDialog task={selectedTask} now={now} onOpenChange={(open) => !open && setSelection(null)} />
		</div>
	);
}
