import { Check, ChevronDown, Database, Eraser, HardDrive, Pencil, Play, Square, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { OnOff } from "~/client/components/onoff";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import type { BackupSchedule } from "~/client/lib/types";
import { BackupProgressCard } from "./backup-progress-card";
import { getBackupProgressOptions, runForgetMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { handleRepositoryError } from "~/client/lib/errors";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/client/components/ui/collapsible";
import { TimeAgo } from "~/client/components/time-ago";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";

type Props = {
	schedule: BackupSchedule;
	handleToggleEnabled: (enabled: boolean) => void;
	handleRunBackupNow: () => void;
	handleStopBackup: () => void;
	handleDeleteSchedule: () => void;
};

export const ScheduleSummary = (props: Props) => {
	const { schedule, handleToggleEnabled, handleRunBackupNow, handleStopBackup, handleDeleteSchedule } = props;
	const { formatShortDateTime } = useTimeFormat();
	const navigate = useNavigate();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [showForgetConfirm, setShowForgetConfirm] = useState(false);
	const [showStopConfirm, setShowStopConfirm] = useState(false);

	const { data: initialProgress } = useSuspenseQuery({
		...getBackupProgressOptions({ path: { shortId: schedule.shortId } }),
	});

	const runForget = useMutation({
		...runForgetMutation(),
		onError: (error) => {
			handleRepositoryError("Failed to apply retention policy", error, schedule.repository.shortId);
		},
	});

	const summary = useMemo(() => {
		const scheduleLabel = schedule ? schedule.cronExpression || "Manual only" : "-";

		const retentionParts: string[] = [];
		if (schedule?.retentionPolicy) {
			const rp = schedule.retentionPolicy;
			if (rp.keepLast) retentionParts.push(`${rp.keepLast} last`);
			if (rp.keepHourly) retentionParts.push(`${rp.keepHourly} hourly`);
			if (rp.keepDaily) retentionParts.push(`${rp.keepDaily} daily`);
			if (rp.keepWeekly) retentionParts.push(`${rp.keepWeekly} weekly`);
			if (rp.keepMonthly) retentionParts.push(`${rp.keepMonthly} monthly`);
			if (rp.keepYearly) retentionParts.push(`${rp.keepYearly} yearly`);
		}

		return {
			vol: schedule.volume.name,
			scheduleLabel,
			repositoryLabel: schedule.repositoryId || "No repository selected",
			retentionLabel: retentionParts.length > 0 ? retentionParts.join(" • ") : "No retention policy",
		};
	}, [schedule]);

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		handleDeleteSchedule();
	};

	const handleConfirmForget = () => {
		setShowForgetConfirm(false);
		toast.promise(runForget.mutateAsync({ path: { shortId: schedule.shortId } }), {
			loading: "Running cleanup...",
			success: "Retention policy applied successfully",
		});
	};

	const handleConfirmStop = () => {
		setShowStopConfirm(false);
		if (schedule.lastBackupStatus !== "in_progress") return;
		handleStopBackup();
	};

	return (
		<div className="space-y-4">
			<Card className="@container">
				<CardHeader className="space-y-4">
					<div className="flex flex-col @medium:flex-row @medium:items-center @medium:justify-between gap-4">
						<div>
							<CardTitle>{schedule.name}</CardTitle>
							<CardDescription className="mt-1">
								<Link
									to="/volumes/$volumeId"
									className="hover:underline"
									params={{ volumeId: schedule.volume.shortId }}
								>
									<HardDrive className="inline h-4 w-4 mr-2" />
									<span>{schedule.volume.name}</span>
								</Link>
								<span className="mx-2">→</span>
								<Link
									to="/repositories/$repositoryId"
									className="hover:underline"
									params={{ repositoryId: schedule.repository.shortId }}
								>
									<Database className="inline h-4 w-4 mr-2 text-strong-accent" />
									<span className="text-strong-accent">{schedule.repository.name}</span>
								</Link>
							</CardDescription>
						</div>
						<div
							className={cn("flex items-center gap-2 justify-between @medium:justify-start", {
								hidden: !schedule.cronExpression,
							})}
						>
							<OnOff
								isOn={schedule.enabled}
								toggle={handleToggleEnabled}
								enabledLabel="Enabled"
								disabledLabel="Paused"
							/>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{schedule.lastBackupStatus === "in_progress" ? (
							<Button variant="destructive" size="sm" onClick={() => setShowStopConfirm(true)}>
								<Square className="h-4 w-4 mr-2" />
								<span>Stop backup</span>
							</Button>
						) : (
							<Button variant="default" size="sm" onClick={handleRunBackupNow}>
								<Play className="h-4 w-4 mr-2" />
								<span>Backup now</span>
							</Button>
						)}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline" size="sm">
									Actions
									<ChevronDown className="h-4 w-4 ml-1" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{schedule.retentionPolicy && (
									<DropdownMenuItem onClick={() => setShowForgetConfirm(true)} disabled={runForget.isPending}>
										<Eraser />
										Run cleanup
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									onClick={() => navigate({ to: "/backups/$backupId/edit", params: { backupId: schedule.shortId } })}
								>
									<Pencil />
									Edit schedule
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
									<Trash2 />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</CardHeader>
				<CardContent className="grid gap-4 grid-cols-1 @medium:grid-cols-2 @wide:grid-cols-4">
					<div>
						<p className="text-xs uppercase text-muted-foreground">Schedule</p>
						<p className="font-medium">{summary.scheduleLabel}</p>
					</div>
					<div>
						<p className="text-xs uppercase text-muted-foreground">Repository</p>
						<p className="font-medium">{schedule.repository.name}</p>
					</div>
					<div>
						<p className="text-xs uppercase text-muted-foreground">Last backup</p>
						<TimeAgo date={schedule.lastBackupAt} className="font-medium" />
					</div>
					<div>
						<p className="text-xs uppercase text-muted-foreground">Next backup</p>
						<p className="font-medium">{formatShortDateTime(schedule.nextBackupAt)}</p>
					</div>

					<div>
						<p className="text-xs uppercase text-muted-foreground">Status</p>
						<p className="font-medium">
							{schedule.lastBackupStatus === "success" && "✓ Success"}
							{schedule.lastBackupStatus === "error" && "✗ Error"}
							{schedule.lastBackupStatus === "in_progress" && "⟳  in progress..."}
							{schedule.lastBackupStatus === "warning" && "! Warning"}
							{!schedule.lastBackupStatus && "—"}
						</p>
					</div>

					{(schedule.lastBackupStatus === "warning" || schedule.lastBackupStatus === "error") && (
						<div className="@medium:col-span-2 @wide:col-span-4">
							<Collapsible
								className={cn("border border-border/50 rounded-lg overflow-hidden", {
									"border-yellow-500/20 bg-yellow-500/5": schedule.lastBackupStatus === "warning",
									"border-red-500/20 bg-red-500/5": schedule.lastBackupStatus === "error",
								})}
							>
								<CollapsibleTrigger
									className={cn("w-full justify-start p-3 hover:bg-muted/50 transition-colors", {
										"hover:bg-yellow-500/10": schedule.lastBackupStatus === "warning",
										"hover:bg-red-500/10": schedule.lastBackupStatus === "error",
									})}
								>
									<span>{schedule.lastBackupStatus === "warning" ? "Warning details" : "Error details"}</span>
								</CollapsibleTrigger>
								<CollapsibleContent
									className={cn("border-t border-border/50 bg-muted/30", {
										"border-yellow-500/20 bg-yellow-500/8": schedule.lastBackupStatus === "warning",
										"border-red-500/20 bg-red-500/8": schedule.lastBackupStatus === "error",
									})}
								>
									<div className="p-3">
										<p
											className={cn("font-mono text-sm whitespace-pre-wrap wrap-break-word", {
												"text-yellow-600": schedule.lastBackupStatus === "warning",
												"text-red-600": schedule.lastBackupStatus === "error",
											})}
										>
											{schedule.lastBackupError ??
												"No additional details available. check your container logs for more information."}
										</p>
									</div>
								</CollapsibleContent>
							</Collapsible>
						</div>
					)}
				</CardContent>
			</Card>

			{schedule.lastBackupStatus === "in_progress" && (
				<BackupProgressCard scheduleShortId={schedule.shortId} initialProgress={initialProgress} />
			)}

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete backup schedule?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this backup schedule for <strong>{schedule.volume.name}</strong>? This
							action cannot be undone. Existing snapshots will not be deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete schedule
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={showForgetConfirm} onOpenChange={setShowForgetConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Run retention policy cleanup?</AlertDialogTitle>
						<AlertDialogDescription>
							This will apply the retention policy and permanently delete old snapshots according to the configured
							rules ({summary.retentionLabel}). This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>
							<X className="h-4 w-4 mr-2" />
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmForget}>
							<Check className="h-4 w-4 mr-2" />
							Run cleanup
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Stop running backup?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to stop the current backup for <strong>{schedule.name}</strong>?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmStop}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Stop backup
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};
