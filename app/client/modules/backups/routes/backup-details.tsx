import { useState } from "react";
import { useQuery, useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
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
	listNotificationDestinationsOptions,
	listRepositoriesOptions,
	listSnapshotsOptions,
	updateBackupScheduleMutation,
	deleteSnapshotMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { useDeletingSnapshots } from "~/client/modules/repositories/snapshots/delete-tasks";
import { parseError, handleRepositoryError } from "~/client/lib/errors";
import { ScheduleSummary } from "../components/schedule-summary";
import { SnapshotFileBrowser } from "../components/snapshot-file-browser";
import { SnapshotTimeline } from "../components/snapshot-timeline";
import { ScheduleNotificationsConfig } from "../components/schedule-notifications-config";
import { ScheduleMirrorsConfig } from "../components/schedule-mirrors-config";
import { BackupSummaryCard } from "~/client/components/backup-summary-card";
import { cn } from "~/client/lib/utils";
import { getVolumeMountPath } from "~/client/lib/volume-path";
import type { BackupSchedule, ScheduleMirror, ScheduleNotification, Snapshot } from "~/client/lib/types";
import { useNavigate } from "@tanstack/react-router";

type Props = {
	loaderData: {
		schedule: BackupSchedule;
		scheduleNotifs: ScheduleNotification[];
		mirrors: ScheduleMirror[];
		snapshots?: Snapshot[];
	};
	scheduleId: string;
	initialSnapshotId?: string;
};

export function ScheduleDetailsPage(props: Props) {
	const { loaderData, scheduleId, initialSnapshotId } = props;

	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/(dashboard)/backups/$backupId/" });
	const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>(initialSnapshotId);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null);

	const { data: schedule } = useSuspenseQuery({
		...getBackupScheduleOptions({ path: { shortId: scheduleId } }),
	});
	const { deletingSnapshotIds } = useDeletingSnapshots(schedule.repository.shortId);

	const { data: repositories } = useSuspenseQuery({
		...listRepositoriesOptions(),
	});

	const { data: notificationDestinations } = useSuspenseQuery({
		...listNotificationDestinationsOptions(),
	});

	const {
		data: snapshots,
		isFetching,
		isPending,
		failureReason,
	} = useQuery({
		...listSnapshotsOptions({
			path: { shortId: schedule.repository.shortId },
			query: { backupId: schedule.shortId },
		}),
		initialData: loaderData.snapshots,
	});

	const updateSchedule = useMutation({
		...updateBackupScheduleMutation(),
		onSuccess: () => {
			toast.success("Backup schedule saved successfully");
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
		},
	});

	const handleToggleEnabled = (enabled: boolean) => {
		updateSchedule.mutate({
			path: { shortId: schedule.shortId },
			body: {
				name: schedule.name,
				repositoryId: schedule.repositoryId,
				enabled,
				cronExpression: schedule.cronExpression,
				retentionPolicy: schedule.retentionPolicy || undefined,
				includePaths: schedule.includePaths || [],
				includePatterns: schedule.includePatterns || [],
				excludePatterns: schedule.excludePatterns || [],
				excludeIfPresent: schedule.excludeIfPresent || [],
				oneFileSystem: schedule.oneFileSystem,
				customResticParams: schedule.customResticParams || [],
				backupWebhooks: schedule.backupWebhooks,
				maxRetries: schedule.maxRetries,
				retryDelay: schedule.retryDelay,
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
					path: { shortId: schedule.repository.shortId, snapshotId: snapshotToDelete },
				}),
				{
					loading: "Starting snapshot deletion...",
					success: "Snapshot deletion started",
					error: (error) => parseError(error)?.message || "Failed to delete snapshot",
				},
			);
		}
	};

	const handleSnapshotSelect = (snapshotId: string) => {
		setSelectedSnapshotId(snapshotId);
		void navigate({
			to: ".",
			search: () => ({ ...searchParams, snapshot: snapshotId }),
			resetScroll: false,
		});
	};

	const selectedSnapshot = snapshots?.find((s) => s.short_id === selectedSnapshotId);
	const isLoadingSnapshots = isPending || (isFetching && !snapshots?.length);

	return (
		<div className="flex flex-col gap-6">
			<ScheduleSummary
				handleToggleEnabled={handleToggleEnabled}
				handleRunBackupNow={() => runBackupNow.mutate({ path: { shortId: schedule.shortId } })}
				handleDeleteSchedule={() => deleteSchedule.mutate({ path: { shortId: schedule.shortId } })}
				schedule={schedule}
			/>
			<div className={cn({ hidden: notificationDestinations.length === 0 })}>
				<ScheduleNotificationsConfig
					scheduleShortId={schedule.shortId}
					destinations={notificationDestinations}
					initialData={loaderData.scheduleNotifs ?? []}
				/>
			</div>
			<div className={cn({ hidden: repositories.length < 2 })}>
				<ScheduleMirrorsConfig
					scheduleShortId={schedule.shortId}
					primaryRepositoryId={schedule.repository.shortId}
					repositories={repositories}
					initialData={loaderData.mirrors ?? []}
				/>
			</div>
			<SnapshotTimeline
				loading={isLoadingSnapshots}
				snapshots={snapshots ?? []}
				snapshotId={selectedSnapshot?.short_id}
				deletingSnapshotIds={deletingSnapshotIds}
				error={failureReason?.message}
				onSnapshotSelect={handleSnapshotSelect}
			/>
			<BackupSummaryCard summary={selectedSnapshot?.summary} />
			{selectedSnapshot && (
				<SnapshotFileBrowser
					key={selectedSnapshot?.short_id}
					snapshot={selectedSnapshot}
					repositoryId={schedule.repository.shortId}
					backupId={schedule.shortId}
					displayBasePath={getVolumeMountPath(schedule.volume)}
					onDeleteSnapshot={handleDeleteSnapshot}
					isDeletingSnapshot={deleteSnapshot.isPending || deletingSnapshotIds.has(selectedSnapshot.short_id)}
				/>
			)}

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete snapshot?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone. This will permanently delete the snapshot and all its data
							from the repository.
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
