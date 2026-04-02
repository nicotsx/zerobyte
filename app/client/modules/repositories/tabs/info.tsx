import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	Archive,
	ChevronDown,
	Clock,
	Database,
	FolderOpen,
	Globe,
	HardDrive,
	Lock,
	Pencil,
	Settings,
	Shield,
	Square,
	Stethoscope,
	Trash2,
	Unlock,
} from "lucide-react";
import { Card, CardContent, CardTitle } from "~/client/components/ui/card";
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import { Separator } from "~/client/components/ui/separator";
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
import type { Repository } from "~/client/lib/types";
import type { GetRepositoryStatsResponse } from "~/client/api-client/types.gen";
import {
	cancelDoctorMutation,
	deleteRepositoryMutation,
	startDoctorMutation,
	unlockRepositoryMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { RepositoryConfig } from "@zerobyte/core/restic";
import { useTimeFormat } from "~/client/lib/datetime";
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

type ConfigRowProps = { icon: React.ReactNode; label: string; value: string; mono?: boolean; valueClassName?: string };
function ConfigRow({ icon, label, value, mono, valueClassName }: ConfigRowProps) {
	return (
		<div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
			<span className="text-muted-foreground shrink-0">{icon}</span>
			<span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
			<span className={cn("text-sm break-all", { "font-mono bg-muted/50 px-2 py-0.5 rounded": mono }, valueClassName)}>
				{value}
			</span>
		</div>
	);
}

export const RepositoryInfoTabContent = ({ repository, initialStats }: Props) => {
	const { formatDateTime, formatTimeAgo } = useTimeFormat();
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
									Created {formatDateTime(repository.createdAt)} &middot; Last checked&nbsp;
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
												error: (e) => parseError(e)?.message || "Failed to unlock repository",
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

				{hasLastError && (
					<Card className="px-6 py-6">
						<div className="space-y-2">
							<p className="text-sm font-medium text-destructive">Last Error</p>
							<p className="text-sm text-muted-foreground wrap-break-word">{repository.lastError}</p>
						</div>
					</Card>
				)}

				<div className="grid grid-cols-1 @wide:grid-cols-2 gap-6">
					<CompressionStatsChart repositoryShortId={repository.shortId} initialStats={initialStats} />

					<Card className="px-6 py-6">
						<CardTitle className="mb-4">Overview</CardTitle>
						<CardContent className="grid grid-cols-2 gap-y-4 gap-x-6 px-0">
							<div className="flex flex-col gap-1">
								<div className="text-sm font-medium text-muted-foreground">Name</div>
								<p className="text-sm">{repository.name}</p>
							</div>
							<div className="flex flex-col gap-1">
								<div className="text-sm font-medium text-muted-foreground">Backend</div>
								<p className="text-sm">{repository.type}</p>
							</div>
							<div className="flex flex-col gap-1">
								<div className="text-sm font-medium text-muted-foreground">Management</div>
								<p className="text-sm">{repository.provisioningId ? "Provisioned" : "Manual"}</p>
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
								<div className="text-sm font-medium text-muted-foreground">Last Checked</div>
								<p className="text-sm flex items-center gap-1.5">
									<Clock className="h-3 w-3 text-muted-foreground" />
									{formatTimeAgo(repository.lastChecked)}
								</p>
							</div>
							{hasLocalPath && (
								<div className="flex flex-col gap-1 col-span-2">
									<div className="text-sm font-medium text-muted-foreground">Local Path</div>
									<p className="text-sm font-mono bg-muted/50 p-2 rounded-md break-all">{effectiveLocalPath}</p>
								</div>
							)}
						</CardContent>
					</Card>
				</div>

				<Card className="px-6 py-6">
					<CardTitle className="flex items-center gap-2 mb-5">
						<Settings className="h-4 w-4 text-muted-foreground" />
						Configuration
					</CardTitle>
					<div className="space-y-0 divide-y divide-border/50">
						<ConfigRow icon={<HardDrive className="h-4 w-4" />} label="Backend" value={repository.type} />
						{hasLocalPath && (
							<ConfigRow
								icon={<FolderOpen className="h-4 w-4" />}
								label="Local Path"
								value={effectiveLocalPath!}
								mono
							/>
						)}
						<ConfigRow
							icon={<Archive className="h-4 w-4" />}
							label="Compression Mode"
							value={repository.compressionMode || "off"}
						/>
						<ConfigRow
							icon={<Globe className="h-4 w-4" />}
							label="Management"
							value={repository.provisioningId ? "Provisioned" : "Manual"}
						/>
						{hasCaCert && (
							<ConfigRow
								icon={<Lock className="h-4 w-4" />}
								label="CA Certificate"
								value="Configured"
								valueClassName="text-success"
							/>
						)}
						{hasInsecureTlsConfig && (
							<ConfigRow
								icon={<Shield className="h-4 w-4" />}
								label="TLS Validation"
								value={config.insecureTls ? "Disabled" : "Enabled"}
								valueClassName={config.insecureTls ? "text-red-500" : "text-success"}
							/>
						)}
					</div>
				</Card>

				<DoctorReport repositoryStatus={repository.status} result={repository.doctorResult} />
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
