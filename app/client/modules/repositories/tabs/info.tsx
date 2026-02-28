import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Square, Stethoscope, Trash2, Unlock } from "lucide-react";
import { Card, CardContent, CardTitle } from "~/client/components/ui/card";
import { Button } from "~/client/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import type { Repository } from "~/client/lib/types";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";
import { formatDateTime, formatTimeAgo } from "~/client/lib/datetime";
import {
	cancelDoctorMutation,
	deleteRepositoryMutation,
	startDoctorMutation,
	unlockRepositoryMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { RepositoryConfig } from "~/schemas/restic";
import { DoctorReport } from "../components/doctor-report";
import { parseError } from "~/client/lib/errors";
import { useNavigate } from "@tanstack/react-router";
import { CompressionStatsChart } from "../components/compression-stats-chart";
import { cn } from "~/client/lib/utils";

type Props = {
	repository: Repository;
	initialStats?: GetRepositoryStatsResponse;
};

const getEffectiveLocalPath = (repository: Repository): string | null => {
	if (repository.config.backend !== "local") return null;
	return repository.config.path;
};

export const RepositoryInfoTabContent = ({ repository, initialStats }: Props) => {
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const navigate = useNavigate();

	const effectiveLocalPath = getEffectiveLocalPath(repository);

	const deleteRepo = useMutation({
		...deleteRepositoryMutation(),
		onSuccess: () => {
			toast.success("Repository deleted successfully");
			void navigate({ to: "/repositories" });
		},
		onError: (error) => {
			toast.error("Failed to delete repository", {
				description: parseError(error)?.message,
			});
		},
	});

	const startDoctor = useMutation({
		...startDoctorMutation(),
		onError: (error) => {
			toast.error("Failed to start doctor", {
				description: parseError(error)?.message,
			});
		},
	});

	const cancelDoctor = useMutation({
		...cancelDoctorMutation(),
		onSuccess: () => {
			toast.info("Doctor operation cancelled");
		},
		onError: (error) => {
			toast.error("Failed to cancel doctor", {
				description: parseError(error)?.message,
			});
		},
	});

	const unlockRepo = useMutation({
		...unlockRepositoryMutation(),
		onSuccess: () => {
			toast.success("Repository unlocked successfully");
		},
		onError: (error) => {
			toast.error("Failed to unlock repository", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteRepo.mutate({ path: { shortId: repository.shortId } });
	};

	const config = repository.config as RepositoryConfig;
	const isDoctorRunning = repository.status === "doctor";
	const hasLocalPath = Boolean(effectiveLocalPath);
	const hasCaCert = Boolean(config.cacert);
	const hasLastError = Boolean(repository.lastError);
	const hasInsecureTlsConfig = config.insecureTls !== undefined;
	const isTlsValidationDisabled = config.insecureTls === true;

	return (
		<>
			<div className="flex flex-col gap-6 @container">
				<div className="flex flex-col @medium:flex-row items-start @medium:items-center justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">Repository Settings</h2>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={() => navigate({ to: `/repositories/${repository.shortId}/edit` })}
						>
							<Pencil className="h-4 w-4 mr-2" />
							Edit
						</Button>
						<Button
							type="button"
							variant="destructive"
							className={cn({ hidden: !isDoctorRunning })}
							loading={cancelDoctor.isPending}
							onClick={() => cancelDoctor.mutate({ path: { shortId: repository.shortId } })}
						>
							<Square className="h-4 w-4 mr-2" />
							<span>Cancel doctor</span>
						</Button>
						<Button
							type="button"
							variant="outline"
							className={cn({ hidden: isDoctorRunning })}
							onClick={() => startDoctor.mutate({ path: { shortId: repository.shortId } })}
							disabled={startDoctor.isPending}
						>
							<Stethoscope className="h-4 w-4 mr-2" />
							Run doctor
						</Button>
						<Button
							type="button"
							variant="outline"
							onClick={() => unlockRepo.mutate({ path: { shortId: repository.shortId } })}
							loading={unlockRepo.isPending}
						>
							<Unlock className="h-4 w-4 mr-2" />
							Unlock
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => setShowDeleteConfirm(true)}
							disabled={deleteRepo.isPending}
						>
							<Trash2 className="h-4 w-4 mr-2" />
							Delete
						</Button>
					</div>
				</div>

				<div className="grid grid-cols-1 @wide:grid-cols-2 gap-6 items-stretch">
					<div className="flex flex-col gap-6">
						<Card className="px-6 py-6">
							<CardTitle>Overview</CardTitle>
							<CardContent className="grid grid-cols-1 @medium:grid-cols-2 gap-y-6 gap-x-4 px-0">
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Name</div>
									<p className="text-sm">{repository.name}</p>
								</div>
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Backend</div>
									<p className="text-sm">{repository.type}</p>
								</div>
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Compression Mode</div>
									<p className="text-sm">{repository.compressionMode || "off"}</p>
								</div>
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Created</div>
									<p className="text-sm">{formatDateTime(repository.createdAt)}</p>
								</div>
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Status</div>
									<p className="text-sm flex items-center gap-2">
										<span
											className={cn("w-2 h-2 rounded-full", {
												"bg-emerald-500": repository.status === "healthy",
												"bg-red-500": repository.status === "error",
												"bg-amber-500": repository.status !== "healthy" && repository.status !== "error",
												"animate-pulse": repository.status === "doctor",
											})}
										/>
										<span className="capitalize">{repository.status || "Unknown"}</span>
									</p>
								</div>
								<div className="flex flex-col gap-1">
									<div className="text-sm font-medium text-muted-foreground">Last Checked</div>
									<p className="text-sm">{formatTimeAgo(repository.lastChecked)}</p>
								</div>
								{hasLocalPath && (
									<div className="flex flex-col gap-1 @medium:col-span-2">
										<div className="text-sm font-medium text-muted-foreground">Local Path</div>
										<p className="text-sm font-mono bg-muted/50 p-2 rounded-md break-all">{effectiveLocalPath}</p>
									</div>
								)}
								{hasCaCert && (
									<div className="flex flex-col gap-1">
										<div className="text-sm font-medium text-muted-foreground">CA Certificate</div>
										<p className="text-sm text-green-500">Configured</p>
									</div>
								)}
								{hasInsecureTlsConfig && (
									<div className="flex flex-col gap-1">
										<div className="text-sm font-medium text-muted-foreground">TLS Validation</div>
										<p className="text-sm">
											<span className={cn("text-red-500", { hidden: !isTlsValidationDisabled })}>Disabled</span>
											<span className={cn("text-green-500", { hidden: isTlsValidationDisabled })}>Enabled</span>
										</p>
									</div>
								)}
							</CardContent>
						</Card>

						{hasLastError && (
							<Card className="px-6 py-6 border-red-500/20 bg-red-500/5">
								<h3 className="text-lg font-medium text-red-500 mb-2">Last Error</h3>
								<p className="text-sm text-red-500/90 font-mono wrap-break-word">{repository.lastError}</p>
							</Card>
						)}

						<div className="flex-1 flex flex-col">
							<DoctorReport repositoryStatus={repository.status} result={repository.doctorResult} />
						</div>
					</div>

					<div className="flex flex-col gap-6">
						<CompressionStatsChart repositoryShortId={repository.shortId} initialStats={initialStats} />

						<Card className="px-6 py-6 flex-1">
							<CardTitle>Configuration</CardTitle>
							<div className="bg-muted/50 rounded-md p-4 max-w-full">
								<pre className="text-sm overflow-auto font-mono whitespace-pre-wrap">
									{JSON.stringify(repository.config, null, 2)}
								</pre>
							</div>
						</Card>
					</div>
				</div>
			</div>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete repository?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the repository <strong>{repository.name}</strong>? This will not remove
							the actual data from the backend storage, only the repository configuration will be deleted.
							<br />
							<br />
							All backup schedules associated with this repository will also be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							disabled={deleteRepo.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							<Trash2 className="h-4 w-4 mr-2" />
							Delete repository
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
