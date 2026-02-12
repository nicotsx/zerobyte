import { CalendarClock, Database, HardDrive } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { BackupSchedule } from "~/client/lib/types";
import { BackupStatusDot } from "./backup-status-dot";
import { formatShortDateTime, formatTimeAgo } from "~/client/lib/datetime";
import { Link } from "@tanstack/react-router";

export const BackupCard = ({ schedule }: { schedule: BackupSchedule }) => {
	return (
		<Link key={schedule.id} to="/backups/$backupId" params={{ backupId: schedule.id.toString() }}>
			<Card key={schedule.id} className="flex flex-col h-full">
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
					<CardDescription className="ml-0.5 flex items-center gap-2 text-xs min-w-0">
						<HardDrive className="h-3.5 w-3.5 shrink-0" />
						<span className="truncate">{schedule.volume.name}</span>
						<span className="text-muted-foreground shrink-0">→</span>
						<Database className="h-3.5 w-3.5 text-strong-accent shrink-0" />
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
							<span className="font-medium">{formatTimeAgo(schedule.lastBackupAt)}</span>
						</div>
						<div className="flex items-center justify-between text-sm">
							<span className="text-muted-foreground">Next backup</span>
							<span className="font-medium">{formatShortDateTime(schedule.nextBackupAt)}</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
};
