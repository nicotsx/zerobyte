import { useId, useState } from "react";
import { useQuery, useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, X } from "lucide-react";
import { Button } from "~/client/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import {
	getBackupScheduleOptions,
	runBackupNowMutation,
	deleteBackupScheduleMutation,
	listSnapshotsOptions,
	updateBackupScheduleMutation,
	stopBackupMutation,
	deleteSnapshotMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { parseError, handleRepositoryError } from "~/client/lib/errors";
import { getCronExpression } from "~/utils/utils";
import { CreateScheduleForm, type BackupScheduleFormValues } from "../components/create-schedule-form";
import { ScheduleSummary } from "../components/schedule-summary";
import { SnapshotFileBrowser } from "../components/snapshot-file-browser";
import { SnapshotTimeline } from "../components/snapshot-timeline";
import { ScheduleNotificationsConfig } from "../components/schedule-notifications-config";
import { ScheduleMirrorsConfig } from "../components/schedule-mirrors-config";
import { BackupSummaryCard } from "~/client/components/backup-summary-card";
import { cn } from "~/client/lib/utils";
import type {
	BackupSchedule,
	NotificationDestination,
	Repository,
	ScheduleMirror,
	ScheduleNotification,
} from "~/client/lib/types";
import { useNavigate } from "@tanstack/react-router";

type Props = {
	loaderData: {
		schedule: BackupSchedule;
		notifs: NotificationDestination[];
		repos: Repository[];
		scheduleNotifs: ScheduleNotification[];
		mirrors: ScheduleMirror[];
	};
	scheduleId: string;
};

export function ScheduleDetailsPage(props: Props) {
	const { loaderData, scheduleId } = props;

	const navigate = useNavigate();
	const [isEditMode, setIsEditMode] = useState(false);
	const formId = useId();
	const [selectedSnapshotId, setSelectedSnapshotId] = useState<string>();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null);

	const { data: schedule } = useSuspenseQuery({
		...getBackupScheduleOptions({ path: { scheduleId } }),
	});

	const {
		data: snapshots,
		isLoading,
		failureReason,
	} = useQuery({
		...listSnapshotsOptions({ path: { id: schedule.repository.id }, query: { backupId: schedule.shortId } }),
	});

	const updateSchedule = useMutation({
		...updateBackupScheduleMutation(),
		onSuccess: () => {
			toast.success("Backup schedule saved successfully");
			setIsEditMode(false);
		},
		onError: (error) => {
			toast.error("Failed to save backup schedule", {
				description: parseError(error)?.message,
			});
		},
	});

	const runBackupNow = useMutation({
		...runBackupNowMutation(),
		onSuccess: () => {
			toast.success("Backup started successfully");
		},
		onError: (error) => {
			handleRepositoryError("Failed to start backup", error, schedule.repository.shortId);
		},
	});

	const stopBackup = useMutation({
		...stopBackupMutation(),
		onSuccess: () => {
			toast.success("Backup stopped successfully");
		},
		onError: (error) => {
			toast.error("Failed to stop backup", { description: parseError(error)?.message });
		},
	});

	const deleteSchedule = useMutation({
		...deleteBackupScheduleMutation(),
		onSuccess: () => {
			toast.success("Backup schedule deleted successfully");
			void navigate({ to: "/backups" });
		},
		onError: (error) => {
			toast.error("Failed to delete backup schedule", { description: parseError(error)?.message });
		},
	});

	const deleteSnapshot = useMutation({
		...deleteSnapshotMutation(),
		onSuccess: () => {
			setShowDeleteConfirm(false);
			setSnapshotToDelete(null);
			if (selectedSnapshotId === snapshotToDelete) {
				setSelectedSnapshotId(undefined);
			}
		},
	});

	const handleSubmit = (formValues: BackupScheduleFormValues) => {
		if (!schedule) return;

		const cronExpression = getCronExpression(
			formValues.frequency,
			formValues.dailyTime,
			formValues.weeklyDay,
			formValues.monthlyDays,
			formValues.cronExpression,
		);

		const retentionPolicy: Record<string, number> = {};
		if (formValues.keepLast) retentionPolicy.keepLast = formValues.keepLast;
		if (formValues.keepHourly) retentionPolicy.keepHourly = formValues.keepHourly;
		if (formValues.keepDaily) retentionPolicy.keepDaily = formValues.keepDaily;
		if (formValues.keepWeekly) retentionPolicy.keepWeekly = formValues.keepWeekly;
		if (formValues.keepMonthly) retentionPolicy.keepMonthly = formValues.keepMonthly;
		if (formValues.keepYearly) retentionPolicy.keepYearly = formValues.keepYearly;

		updateSchedule.mutate({
			path: { scheduleId: schedule.id.toString() },
			body: {
				name: formValues.name,
				repositoryId: formValues.repositoryId,
				enabled: schedule.enabled,
				cronExpression,
				retentionPolicy: Object.keys(retentionPolicy).length > 0 ? retentionPolicy : undefined,
				includePatterns: formValues.includePatterns,
				excludePatterns: formValues.excludePatterns,
				excludeIfPresent: formValues.excludeIfPresent,
				oneFileSystem: formValues.oneFileSystem,
			},
		});
	};

	const handleToggleEnabled = (enabled: boolean) => {
		updateSchedule.mutate({
			path: { scheduleId: schedule.id.toString() },
			body: {
				repositoryId: schedule.repositoryId,
				enabled,
				cronExpression: schedule.cronExpression,
				retentionPolicy: schedule.retentionPolicy || undefined,
				includePatterns: schedule.includePatterns || [],
				excludePatterns: schedule.excludePatterns || [],
				excludeIfPresent: schedule.excludeIfPresent || [],
				oneFileSystem: schedule.oneFileSystem,
			},
		});
	};

	const handleDeleteSnapshot = (snapshotId: string) => {
		setSnapshotToDelete(snapshotId);
		setShowDeleteConfirm(true);
	};

	const handleConfirmDelete = () => {
		if (snapshotToDelete) {
			toast.promise(
				deleteSnapshot.mutateAsync({
					path: { id: schedule.repository.shortId, snapshotId: snapshotToDelete },
				}),
				{
					loading: "Deleting snapshot...",
					success: "Snapshot deleted successfully",
					error: (error) => parseError(error)?.message || "Failed to delete snapshot",
				},
			);
		}
	};

	if (isEditMode) {
		return (
			<div>
				<CreateScheduleForm volume={schedule.volume} initialValues={schedule} onSubmit={handleSubmit} formId={formId} />
				<div className="flex justify-end mt-4 gap-2">
					<Button type="submit" className="ml-auto" variant="primary" form={formId} loading={updateSchedule.isPending}>
						<Save className="h-4 w-4 mr-2" />
						Update schedule
					</Button>
					<Button variant="outline" onClick={() => setIsEditMode(false)}>
						<X className="h-4 w-4 mr-2" />
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	const selectedSnapshot = snapshots?.find((s) => s.short_id === selectedSnapshotId);

	return (
		<div className="flex flex-col gap-6">
			<ScheduleSummary
				handleToggleEnabled={handleToggleEnabled}
				handleRunBackupNow={() => runBackupNow.mutate({ path: { scheduleId: schedule.id.toString() } })}
				handleStopBackup={() => stopBackup.mutate({ path: { scheduleId: schedule.id.toString() } })}
				handleDeleteSchedule={() => deleteSchedule.mutate({ path: { scheduleId: schedule.id.toString() } })}
				setIsEditMode={setIsEditMode}
				schedule={schedule}
			/>
			<div className={cn({ hidden: !loaderData.notifs?.length })}>
				<ScheduleNotificationsConfig
					scheduleId={schedule.id}
					destinations={loaderData.notifs ?? []}
					initialData={loaderData.scheduleNotifs ?? []}
				/>
			</div>
			<div className={cn({ hidden: !loaderData.repos?.length || loaderData.repos.length < 2 })}>
				<ScheduleMirrorsConfig
					scheduleId={schedule.id}
					primaryRepositoryId={schedule.repositoryId}
					repositories={loaderData.repos ?? []}
					initialData={loaderData.mirrors ?? []}
				/>
			</div>
			<SnapshotTimeline
				loading={isLoading}
				snapshots={snapshots ?? []}
				snapshotId={selectedSnapshot?.short_id}
				error={failureReason?.message}
				onSnapshotSelect={setSelectedSnapshotId}
			/>
			<BackupSummaryCard summary={selectedSnapshot?.summary} />
			{selectedSnapshot && (
				<SnapshotFileBrowser
					key={selectedSnapshot?.short_id}
					snapshot={selectedSnapshot}
					repositoryId={schedule.repository.shortId}
					backupId={schedule.id.toString()}
					onDeleteSnapshot={handleDeleteSnapshot}
					isDeletingSnapshot={deleteSnapshot.isPending}
				/>
			)}

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the snapshot and all its data from the
							repository.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							disabled={deleteSnapshot.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete snapshot
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
