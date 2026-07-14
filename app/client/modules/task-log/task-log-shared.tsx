import type { ListTaskHistoryResponse } from "~/client/api-client";
import { Ban, Check, CircleX, Clock3, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "~/client/lib/utils";
import { taskHistoryOutcomeLabels, type TaskHistoryOutcome } from "~/schemas/task-history";
import type { TaskKind } from "~/schemas/tasks";

export type TaskLogKind = TaskKind;
export type TaskLogOutcome = TaskHistoryOutcome;
export type TaskLogItem = ListTaskHistoryResponse["items"][number];

export const formatTaskDuration = (
	item: Pick<TaskLogItem, "outcome" | "createdAt" | "startedAt" | "finishedAt">,
	now: number,
) => {
	const startedAt = item.startedAt ?? item.createdAt;
	const finishedAt = item.outcome === "running" ? now : (item.finishedAt ?? startedAt);
	const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));

	if (seconds < 1) return "<1s";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;

	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
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
			{taskHistoryOutcomeLabels[outcome]}
		</span>
	);
}

export function TaskLogTarget({ target }: Pick<TaskLogItem, "target">) {
	const content = (
		<span className="flex min-w-0 flex-col">
			<span
				className={cn("max-w-58 truncate font-medium", {
					"text-strong-accent": target.href,
				})}
			>
				{target.label}
			</span>
			{target.secondary && (
				<span className="max-w-58 truncate text-xs text-muted-foreground">{target.secondary}</span>
			)}
		</span>
	);

	return target.href ? (
		<a
			href={target.href}
			className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			{content}
		</a>
	) : (
		content
	);
}
