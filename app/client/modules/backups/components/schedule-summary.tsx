import { Database, Eraser, HardDrive, Pencil, Play, Square, Trash2 } from "lucide-react";
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
import type { BackupSchedule } from "~/client/lib/types";
import { BackupProgressCard } from "./backup-progress-card";
import { runForgetMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { parseError } from "~/client/lib/errors";
import { Link } from "react-router";

type Props = {
	schedule: BackupSchedule;
	handleToggleEnabled: (enabled: boolean) => void;
	handleRunBackupNow: () => void;
	handleStopBackup: () => void;
	handleDeleteSchedule: () => void;
	setIsEditMode: (isEdit: boolean) => void;
};

export const ScheduleSummary = (props: Props) => {
	const { schedule, handleToggleEnabled, handleRunBackupNow, handleStopBackup, handleDeleteSchedule, setIsEditMode } =
		props;
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [showForgetConfirm, setShowForgetConfirm] = useState(false);

	const runForget = useMutation({
		...runForgetMutation(),
		onSuccess: () => {
			toast.success("Retention policy applied successfully");
		},
		onError: (error) => {
			toast.error("Failed to apply retention policy", { description: parseError(error)?.message });
		},
	});

	const summary = useMemo(() => {
		const scheduleLabel = schedule ? schedule.cronExpression : "-";

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
	}, [schedule, schedule.volume.name]);

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		handleDeleteSchedule();
	};

	const handleConfirmForget = () => {
		setShowForgetConfirm(false);
		runForget.mutate({ path: { scheduleId: schedule.id.toString() } });
	};

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="space-y-4">
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
						<div>
							<CardTitle>{schedule.name}</CardTitle>
							<CardDescription className="mt-1">
								<Link to={`/volumes/${schedule.volume.name}`} className="hover:underline">
									<HardDrive className="inline h-4 w-4 mr-2" />
									<span>{schedule.volume.name}</span>
								</Link>
								<span className="mx-2">→</span>
								<Link to={`/repositories/${schedule.repository.name}`} className="hover:underline">
									<Database className="inline h-4 w-4 mr-2 text-strong-accent" />
									<span className="text-strong-accent">{schedule.repository.name}</span>
								</Link>
							</CardDescription>
						</div>
						<div className="flex items-center gap-2 justify-between sm:justify-start">
							<OnOff
								isOn={schedule.enabled}
								toggle={handleToggleEnabled}
								enabledLabel="Enabled"
								disabledLabel="Paused"
							/>
						</div>
					</div>
					<div className="flex flex-col sm:flex-row gap-2">
						{schedule.lastBackupStatus === "in_progress" ? (
							<Button variant="destructive" size="sm" onClick={handleStopBackup} className="w-full sm:w-auto">
								<Square className="h-4 w-4 mr-2" />
								<span className="sm:inline">Stop backup</span>
							</Button>
						) : (
							<Button variant="default" size="sm" onClick={handleRunBackupNow} className="w-full sm:w-auto">
								<Play className="h-4 w-4 mr-2" />
								<span className="sm:inline">Backup now</span>
							</Button>
						)}
						{schedule.retentionPolicy && (
							<Button
								variant="outline"
								size="sm"
								loading={runForget.isPending}
								onClick={() => setShowForgetConfirm(true)}
								className="w-full sm:w-auto"
							>
								<Eraser className="h-4 w-4 mr-2" />
								<span className="sm:inline">Run cleanup</span>
							</Button>
						)}
						<Button variant="outline" size="sm" onClick={() => setIsEditMode(true)} className="w-full sm:w-auto">
							<Pencil className="h-4 w-4 mr-2" />
							<span className="sm:inline">Edit schedule</span>
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowDeleteConfirm(true)}
							className="text-destructive hover:text-destructive w-full sm:w-auto"
						>
							<Trash2 className="h-4 w-4 mr-2" />
							<span className="sm:inline">Delete</span>
						</Button>
					</div>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
						<p className="font-medium">
							{schedule.lastBackupAt ? new Date(schedule.lastBackupAt).toLocaleString() : "Never"}
						</p>
					</div>
					<div>
						<p className="text-xs uppercase text-muted-foreground">Next backup</p>
						<p className="font-medium">
							{schedule.nextBackupAt ? new Date(schedule.nextBackupAt).toLocaleString() : "Never"}
						</p>
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

					{schedule.lastBackupStatus === "warning" && (
						<div className="md:col-span-2 lg:col-span-4">
							<p className="text-xs uppercase text-muted-foreground">Warning Details</p>
							<p className="font-mono text-sm text-yellow-600 whitespace-pre-wrap break-all">
								Last backup completed with warnings. Check your container logs for more details.
							</p>
						</div>
					)}

					{schedule.lastBackupError && (
						<div className="md:col-span-2 lg:col-span-4">
							<p className="text-xs uppercase text-muted-foreground">Error Details</p>
							<p className="font-mono text-sm text-red-600 whitespace-pre-wrap break-all">{schedule.lastBackupError}</p>
						</div>
					)}
				</CardContent>
			</Card>

			{schedule.lastBackupStatus === "in_progress" && <BackupProgressCard scheduleId={schedule.id} />}

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
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmForget}>Run cleanup</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
};
