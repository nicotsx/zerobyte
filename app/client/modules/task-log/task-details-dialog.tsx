import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "~/client/components/ui/dialog";
import { useTimeFormat } from "~/client/lib/datetime";
import { formatTaskDuration, OutcomeStatus, TaskLogTarget, type TaskLogItem } from "./task-log-shared";

const humanizeStatus = (status: TaskLogItem["status"]) => {
	return status.charAt(0).toUpperCase() + status.slice(1);
};

export function TaskDetailsDialog({
	task,
	now,
	onOpenChange,
}: {
	task: TaskLogItem | null;
	now: number;
	onOpenChange: (open: boolean) => void;
}) {
	const { formatDateTimeWithSeconds } = useTimeFormat();

	return (
		<Dialog open={task !== null} onOpenChange={onOpenChange}>
			<DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-xl">
				{task && (
					<>
						<DialogHeader className="border-b px-6 py-5 pr-12">
							<DialogTitle>Task details</DialogTitle>
							<DialogDescription className="truncate">
								{task.taskType} · {task.target.label}
							</DialogDescription>
						</DialogHeader>
						<div className="min-h-0 overflow-y-auto px-6 py-5 overscroll-contain">
							<dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-5 gap-y-3 text-sm">
								<dt className="text-muted-foreground">Task type</dt>
								<dd className="font-medium">{task.taskType}</dd>
								<dt className="text-muted-foreground">Target</dt>
								<dd>
									<TaskLogTarget target={task.target} />
								</dd>
								<dt className="text-muted-foreground">Outcome</dt>
								<dd>
									<OutcomeStatus outcome={task.outcome} />
								</dd>
								<dt className="text-muted-foreground">Lifecycle</dt>
								<dd>{humanizeStatus(task.status)}</dd>
								<dt className="text-muted-foreground">Created</dt>
								<dd className="tabular-nums">{formatDateTimeWithSeconds(task.createdAt)}</dd>
								<dt className="text-muted-foreground">Started</dt>
								<dd className="tabular-nums">
									{task.startedAt === null
										? "Not started"
										: formatDateTimeWithSeconds(task.startedAt)}
								</dd>
								<dt className="text-muted-foreground">Finished</dt>
								<dd className="tabular-nums">
									{task.finishedAt === null
										? "Not finished"
										: formatDateTimeWithSeconds(task.finishedAt)}
								</dd>
								<dt className="text-muted-foreground">Duration</dt>
								<dd className="tabular-nums">{formatTaskDuration(task, now)}</dd>
							</dl>
							{task.message && (
								<div className="mt-5 rounded-md border bg-muted/40 p-4">
									<p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
										Details
									</p>
									<p className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed">
										{task.message}
									</p>
								</div>
							)}
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
