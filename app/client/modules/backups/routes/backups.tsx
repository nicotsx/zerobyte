import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Database, HardDrive, Plus } from "lucide-react";
import { Link } from "react-router";
import { BackupStatusDot } from "../components/backup-status-dot";
import { EmptyState } from "~/client/components/empty-state";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import type { Route } from "./+types/backups";
import { listBackupSchedules } from "~/client/api-client";
import { listBackupSchedulesOptions } from "~/client/api-client/@tanstack/react-query.gen";

export const handle = {
	breadcrumb: () => [{ label: "Backups" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Backup Jobs" },
		{
			name: "description",
			content: "Automate volume backups with scheduled jobs and retention policies.",
		},
	];
}

export const clientLoader = async () => {
	const jobs = await listBackupSchedules();
	if (jobs.data) return jobs.data;
	return [];
};

export default function Backups({ loaderData }: Route.ComponentProps) {
	const { data: schedules, isLoading } = useQuery({
		...listBackupSchedulesOptions(),
		initialData: loaderData,
	});

	if (isLoading) {
		return (
			<div className="flex items-center justify-center h-full">
				<p className="text-muted-foreground">Loading backup schedules...</p>
			</div>
		);
	}

	if (!schedules || schedules.length === 0) {
		return (
			<EmptyState
				icon={CalendarClock}
				title="No backup job"
				description="Backup jobs help you automate the process of backing up your volumes on a regular schedule to ensure your data is safe and secure."
				button={
					<Button>
						<Link to="/backups/create" className="flex items-center">
							<Plus className="h-4 w-4 mr-2" />
							Create a backup job
						</Link>
					</Button>
				}
			/>
		);
	}

	return (
		<div className="container mx-auto space-y-6">
			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 auto-rows-fr">
				{schedules.map((schedule) => (
					<Link key={schedule.id} to={`/backups/${schedule.id}`}>
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
				))}
				<Link to="/backups/create">
					<Card className="flex flex-col items-center justify-center h-full hover:bg-muted/50 transition-colors cursor-pointer">
						<CardContent className="flex flex-col items-center justify-center gap-2">
							<Plus className="h-8 w-8 text-muted-foreground" />
							<span className="text-sm font-medium text-muted-foreground">Create a backup job</span>
						</CardContent>
					</Card>
				</Link>
			</div>
		</div>
	);
}
