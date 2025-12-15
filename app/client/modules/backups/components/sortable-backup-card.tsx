import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Database, GripVertical, HardDrive } from "lucide-react";
import { Link } from "react-router";
import { BackupStatusDot } from "./backup-status-dot";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { ListBackupSchedulesResponse } from "~/client/api-client";

type Schedule = ListBackupSchedulesResponse[number];

interface SortableBackupCardProps {
	schedule: Schedule;
	isDragging?: boolean;
}

/**
 * Render a draggable backup schedule card that displays name, status, volume/repository and schedule metadata.
 *
 * @param schedule - The backup schedule object to display (name, id, cronExpression, timestamps, volume and repository info, enabled/status fields).
 * @param isDragging - Optional flag indicating the card is currently being dragged; used to adjust visual appearance.
 * @returns The JSX element for the sortable backup schedule card.
 */
export function SortableBackupCard({ schedule, isDragging }: SortableBackupCardProps) {
	const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
		id: schedule.id,
	});

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div ref={setNodeRef} style={style} className="relative group">
			<div
				{...attributes}
				{...listeners}
				className="absolute left-1/2 -translate-x-1/2 top-1 z-10 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted/50 bg-background/80 backdrop-blur-sm"
			>
				<GripVertical className="h-4 w-4 text-muted-foreground rotate-90" />
			</div>
			<Link to={`/backups/${schedule.id}`} className="block">
				<Card className="flex flex-col h-full hover:bg-muted/30 transition-colors">
					<CardHeader className="pb-3 overflow-hidden">
						<div className="flex items-center justify-between gap-2 w-full">
							<div className="flex items-center gap-2 flex-1 min-w-0 w-0">
								<CalendarClock className="h-5 w-5 text-muted-foreground shrink-0" />
								<CardTitle className="text-lg truncate">{schedule.name}</CardTitle>
							</div>
							<BackupStatusDot
								enabled={schedule.enabled}
								hasError={!!schedule.lastBackupError}
								isInProgress={schedule.lastBackupStatus === "in_progress"}
							/>
						</div>
						<CardDescription className="ml-0.5 flex items-center gap-2 text-xs">
							<HardDrive className="h-3.5 w-3.5" />
							<span className="truncate">{schedule.volume.name}</span>
							<span className="text-muted-foreground">→</span>
							<Database className="h-3.5 w-3.5 text-strong-accent" />
							<span className="truncate text-strong-accent">{schedule.repository.name}</span>
						</CardDescription>
					</CardHeader>
					<CardContent className="flex-1 space-y-4">
						<div className="space-y-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Schedule</span>
								<code className="text-xs bg-muted px-2 py-1 rounded">{schedule.cronExpression}</code>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Last backup</span>
								<span className="font-medium">
									{schedule.lastBackupAt ? new Date(schedule.lastBackupAt).toLocaleDateString() : "Never"}
								</span>
							</div>
							<div className="flex items-center justify-between text-sm">
								<span className="text-muted-foreground">Next backup</span>
								<span className="font-medium">
									{schedule.nextBackupAt ? new Date(schedule.nextBackupAt).toLocaleDateString() : "N/A"}
								</span>
							</div>
						</div>
					</CardContent>
				</Card>
			</Link>
		</div>
	);
}