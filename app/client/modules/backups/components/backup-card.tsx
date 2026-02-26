import { CalendarClock, Database, HardDrive } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { BackupSchedule } from "~/client/lib/types";
import { BackupStatusDot } from "./backup-status-dot";
import { formatShortDateTime, formatTimeAgo } from "~/client/lib/datetime";
import { Link } from "@tanstack/react-router";

export const BackupCard = ({ schedule }: { schedule: BackupSchedule }) => {
	return (
		<Link key={schedule.shortId} to="/backups/$backupId" params={{ backupId: schedule.shortId }}>
			<Card interactive key={schedule.shortId} className="flex flex-col h-full">
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
						<span className="truncate font-mono">{schedule.volume.name}</span>
						<span className="text-muted-foreground shrink-0">→</span>
						<Database className="h-3.5 w-3.5 text-strong-accent shrink-0" />
						<span className="truncate text-strong-accent font-mono">{schedule.repository.name}</span>
					</CardDescription>
				</CardHeader>
				<CardContent className="flex-1 space-y-4">
					<div className="space-y-3">
						<div className="flex items-center text-sm gap-2">
							<span className="text-zinc-500 shrink-0">Schedule</span>
							<div className="flex-1 border-b border-dashed border-white/10" />
							<code className="text-xs text-zinc-100 font-mono bg-muted px-2 py-1 rounded shrink-0">
								{schedule.cronExpression}
							</code>
						</div>
						<div className="flex items-center text-sm gap-2">
							<span className="text-zinc-500 shrink-0">Last backup</span>
							<div className="flex-1 border-b border-dashed border-white/10" />
							<span className="text-zinc-100 font-mono text-sm shrink-0">{formatTimeAgo(schedule.lastBackupAt)}</span>
						</div>
						<div className="flex items-center text-sm gap-2">
							<span className="text-zinc-500 shrink-0">Next backup</span>
							<div className="flex-1 border-b border-dashed border-white/10" />
							<span className="text-zinc-100 font-mono text-sm shrink-0">
								{formatShortDateTime(schedule.nextBackupAt)}
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</Link>
	);
};
