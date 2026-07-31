import { Copy } from "lucide-react";
import { TableCell, TableRow } from "~/client/components/ui/table";
import type { TaskOfKind } from "~/client/hooks/use-active-tasks";
import { cn } from "~/client/lib/utils";

type MirrorSyncTask = TaskOfKind<"mirrorSync">;

type Props = {
	tasks: MirrorSyncTask[];
};

const taskStatusPriority: Record<MirrorSyncTask["status"], number> = {
	cancelling: 0,
	running: 1,
	queued: 2,
	cancelled: 3,
	succeeded: 3,
	failed: 3,
	stale: 3,
};

const getTaskTitle = (task: MirrorSyncTask) => {
	if (task.status === "cancelling") {
		return "Cancelling mirror sync";
	}
	if (task.status === "queued") {
		return "Waiting for repository access";
	}
	if (task.progress?.phase === "retention") {
		return "Applying retention policy";
	}
	if (task.progress?.phase === "copying") {
		return "Copying snapshots";
	}
	return "Preparing snapshot copy";
};

const getQueuedTaskDetail = (task: MirrorSyncTask) => {
	const snapshotCount = task.input.snapshotIds?.length;
	if (!snapshotCount) {
		return "Latest snapshot queued";
	}

	const snapshotLabel = snapshotCount === 1 ? "snapshot" : "snapshots";
	return `${snapshotCount.toLocaleString()} ${snapshotLabel} queued`;
};

const MirrorSyncTaskProgress = ({ task }: { task: MirrorSyncTask }) => {
	const resticMessage = task.progress?.phase === "copying" ? task.progress.message : null;
	const queuedDetail = task.status === "queued" ? getQueuedTaskDetail(task) : null;
	const detail = resticMessage ?? queuedDetail;
	const title = getTaskTitle(task);

	return (
		<div className="space-y-1">
			<div className="flex min-w-0 items-center justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<Copy className="text-primary size-3.5 shrink-0" aria-hidden="true" />
					<span className="truncate text-xs font-medium text-foreground">{title}</span>
				</div>
			</div>

			{detail && (
				<p
					className={cn("text-[11px] text-muted-foreground", resticMessage && "truncate font-mono")}
					title={resticMessage ?? undefined}
				>
					{detail}
				</p>
			)}
		</div>
	);
};

export const MirrorSyncProgressRow = ({ tasks }: Props) => {
	const sortedTasks = [...tasks].sort((left, right) => {
		const leftPriority = taskStatusPriority[left.status];
		const rightPriority = taskStatusPriority[right.status];
		return leftPriority - rightPriority;
	});

	return (
		<TableRow className="border-t-0 bg-muted/20 hover:bg-muted/20">
			<TableCell colSpan={4} className="px-4 py-3 whitespace-normal">
				<div
					className={cn(
						"grid gap-3",
						sortedTasks.length > 1 && "divide-y divide-border/70 [&>*:not(:first-child)]:pt-3",
					)}
				>
					{sortedTasks.map((task) => (
						<MirrorSyncTaskProgress key={task.id} task={task} />
					))}
				</div>
			</TableCell>
		</TableRow>
	);
};
