import type { ListTaskHistoryResponse } from "~/client/api-client";
import { Ban, Check, CircleX, Clock3, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "~/client/lib/utils";
import type { TaskHistoryOutcome } from "~/schemas/task-history";
import type { TaskKind } from "~/schemas/tasks";

export type TaskLogKind = TaskKind;
export type TaskLogOutcome = TaskHistoryOutcome;
export type TaskLogItem = ListTaskHistoryResponse["items"][number];

export const taskLogKindLabels = {
	backup: "Backup",
	restore: "Restore",
	deleteSnapshots: "Delete snapshots",
	tagSnapshots: "Update snapshot tags",
	doctor: "Repository doctor",
	mirrorSync: "Mirror sync",
} satisfies Record<TaskLogKind, string>;

export const taskLogOutcomeLabels = {
	running: "Running",
	success: "Success",
	warning: "Warning",
	error: "Error",
	cancelled: "Cancelled",
	stale: "Stale",
} satisfies Record<TaskLogOutcome, string>;

export const getTaskDurationSeconds = (
	item: Pick<TaskLogItem, "outcome" | "createdAt" | "startedAt" | "finishedAt">,
	now: number,
) => {
	const startedAt = item.startedAt ?? item.createdAt;
	const finishedAt = item.outcome === "running" ? now : (item.finishedAt ?? startedAt);

	return Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
};

const outcomePresentation = {
	running: {
		icon: LoaderCircle,
		iconClassName: "animate-spin text-sky-600 dark:text-sky-400",
	},
	success: {
		icon: Check,
		iconClassName: "text-emerald-600 dark:text-emerald-400",
	},
	warning: {
		icon: TriangleAlert,
		iconClassName: "text-amber-600 dark:text-amber-400",
	},
	error: {
		icon: CircleX,
		iconClassName: "text-destructive",
	},
	cancelled: {
		icon: Ban,
		iconClassName: "text-muted-foreground",
	},
	stale: {
		icon: Clock3,
		iconClassName: "text-orange-600 dark:text-orange-400",
	},
} satisfies Record<TaskLogOutcome, { icon: LucideIcon; iconClassName: string }>;

export function OutcomeStatus({ outcome }: { outcome: TaskLogItem["outcome"] }) {
	if (outcome === null) {
		return <span className="text-sm text-muted-foreground">Not recorded</span>;
	}

	const presentation = outcomePresentation[outcome];
	const Icon = presentation.icon;

	return (
		<span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-foreground">
			<Icon aria-hidden="true" className={cn("size-3.5 stroke-[2.25]", presentation.iconClassName)} />
			{taskLogOutcomeLabels[outcome]}
		</span>
	);
}

const getTaskLogTargetHref = (target: TaskLogItem["target"]) => {
	switch (target.kind) {
		case "backupSchedule":
			return `/backups/${target.scheduleShortId}`;
		case "repository": {
			const repositoryHref = `/repositories/${encodeURIComponent(target.repositoryShortId)}`;
			if (target.snapshotId) {
				return `${repositoryHref}/${encodeURIComponent(target.snapshotId)}`;
			}

			return repositoryHref;
		}
		case "unavailable":
			return null;
	}
};

export function TaskLogTarget({ target }: Pick<TaskLogItem, "target">) {
	const href = getTaskLogTargetHref(target);
	const content = (
		<span className="flex min-w-0 flex-col">
			<span
				className={cn("max-w-58 truncate font-medium", {
					"text-strong-accent": href !== null,
				})}
			>
				{target.label}
			</span>
			{target.secondary && (
				<span className="max-w-58 truncate text-xs text-muted-foreground">{target.secondary}</span>
			)}
		</span>
	);

	if (href === null) {
		return content;
	}

	return (
		<a href={href} className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
			{content}
		</a>
	);
}
