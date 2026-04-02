import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, Database, Pencil, Square, Stethoscope, Trash2, Unlock } from "lucide-react";
import {
	cancelDoctorMutation,
	deleteRepositoryMutation,
	getRepositoryOptions,
	startDoctorMutation,
	unlockRepositoryMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import { Separator } from "~/client/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { formatDateTime, formatTimeAgo } from "~/client/lib/datetime";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import type { BackupSchedule, Snapshot } from "~/client/lib/types";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";
import { RepositoryInfoTabContent } from "../tabs/info";
import { RepositorySnapshotsTabContent } from "../tabs/snapshots";

export default function RepositoryDetailsPage({
	repositoryId,
	initialSnapshots,
	initialBackupSchedules,
	initialStats,
}: {
	repositoryId: string;
	initialSnapshots?: Snapshot[];
	initialBackupSchedules?: BackupSchedule[];
	initialStats?: GetRepositoryStatsResponse;
}) {
	const navigate = useNavigate();
	const { tab } = useSearch({ from: "/(dashboard)/repositories/$repositoryId/" });
	const activeTab = tab || "info";

	const { data: repository } = useSuspenseQuery({
		...getRepositoryOptions({ path: { shortId: repositoryId } }),
	});

	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteRepo.mutate({ path: { shortId: repository.shortId } });
	};

	const isDoctorRunning = repository.status === "doctor";

	return (
		<>
			<div className="flex flex-col gap-6 @container">
				<Card className="px-6 py-5">
					<div className="flex flex-col @wide:flex-row @wide:items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<div className="hidden @medium:flex items-center justify-center w-10 h-10 rounded-lg bg-muted/50 border border-border/50">
								<Database className="h-5 w-5 text-muted-foreground" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-lg font-semibold tracking-tight">{repository.name}</h2>
									<Separator orientation="vertical" className="h-4 mx-1" />
									<Badge variant="outline" className="capitalize gap-1.5">
										<span
											className={cn("w-2 h-2 rounded-full shrink-0", {
												"bg-success": repository.status === "healthy",
												"bg-red-500": repository.status === "error",
												"bg-amber-500": repository.status !== "healthy" && repository.status !== "error",
												"animate-pulse": repository.status === "doctor",
											})}
										/>
										{repository.status || "Unknown"}
									</Badge>
									<Badge variant="secondary">{repository.type}</Badge>
									{repository.provisioningId && <Badge variant="secondary">Managed</Badge>}
								</div>
								<p className="text-sm text-muted-foreground mt-0.5">
									Created {formatDateTime(repository.createdAt)} &middot; Last checked{" "}
									{formatTimeAgo(repository.lastChecked)}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							{isDoctorRunning ? (
								<Button
									type="button"
									variant="destructive"
									loading={cancelDoctor.isPending}
									onClick={() => cancelDoctor.mutate({ path: { shortId: repository.shortId } })}
								>
									<Square className="h-4 w-4 mr-2" />
									Cancel doctor
								</Button>
							) : (
								<Button
									type="button"
									variant="outline"
									onClick={() => startDoctor.mutate({ path: { shortId: repository.shortId } })}
									disabled={startDoctor.isPending}
								>
									<Stethoscope className="h-4 w-4 mr-2" />
									Run doctor
								</Button>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="outline">
										Actions
										<ChevronDown className="h-4 w-4 ml-1" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => navigate({ to: `/repositories/${repository.shortId}/edit` })}>
										<Pencil />
										Edit
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() =>
											toast.promise(unlockRepo.mutateAsync({ path: { shortId: repository.shortId } }), {
												loading: "Unlocking repo",
												success: "Repository unlocked successfully",
												error: (e) =>
													toast.error("Failed to unlock repository", {
														description: parseError(e)?.message,
													}),
											})
										}
										disabled={unlockRepo.isPending}
									>
										<Unlock />
										Unlock
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onClick={() => setShowDeleteConfirm(true)}
										disabled={deleteRepo.isPending}
									>
										<Trash2 />
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				</Card>

				{repository.lastError && (
					<Card className="px-6 py-6">
						<div className="space-y-2">
							<p className="text-sm font-medium text-destructive">Last Error</p>
							<p className="text-sm text-muted-foreground wrap-break-word">{repository.lastError}</p>
						</div>
					</Card>
				)}

				<Tabs value={activeTab} onValueChange={(value) => navigate({ to: ".", search: () => ({ tab: value }) })}>
					<TabsList className="mb-2">
						<TabsTrigger value="info">Configuration</TabsTrigger>
						<TabsTrigger value="snapshots">Snapshots</TabsTrigger>
					</TabsList>
					<TabsContent value="info">
						<RepositoryInfoTabContent repository={repository} initialStats={initialStats} />
					</TabsContent>
					<TabsContent value="snapshots">
						<Suspense>
							<RepositorySnapshotsTabContent
								repository={repository}
								initialSnapshots={initialSnapshots}
								initialBackupSchedules={initialBackupSchedules}
							/>
						</Suspense>
					</TabsContent>
				</Tabs>
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
}
