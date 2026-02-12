import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Pencil, Square, Stethoscope, Trash2, Unlock } from "lucide-react";
import { Card } from "~/client/components/ui/card";
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
import { REPOSITORY_BASE } from "~/client/lib/constants";
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

type Props = {
	repository: Repository;
};

const getEffectiveLocalPath = (repository: Repository): string | null => {
	if (repository.config.backend !== "local") return null;
	return repository.config.path;
};

export const RepositoryInfoTabContent = ({ repository }: Props) => {
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
		deleteRepo.mutate({ path: { id: repository.id } });
	};

	const config = repository.config as RepositoryConfig;

	return (
		<>
			<Card className="p-6 space-y-6">
				<div className="flex flex-col sm:flex-row items-center justify-between gap-2">
					<div>
						<span className="text-lg font-semibold mb-4">Repository Settings</span>
					</div>
					<div className="flex flex-wrap justify-end gap-2 sm:gap-4">
						<Button
							type="button"
							variant="outline"
							onClick={() => navigate({ to: `/repositories/${repository.shortId}/edit` })}
						>
							<Pencil className="h-4 w-4 mr-2" />
							Edit
						</Button>
						{repository.status === "doctor" ? (
							<Button
								type="button"
								variant="destructive"
								loading={cancelDoctor.isPending}
								onClick={() => cancelDoctor.mutate({ path: { id: repository.id } })}
							>
								<Square className="h-4 w-4 mr-2" />
								<span>Cancel doctor</span>
							</Button>
						) : (
							<Button
								type="button"
								onClick={() => startDoctor.mutate({ path: { id: repository.id } })}
								disabled={startDoctor.isPending}
							>
								<Stethoscope className="h-4 w-4 mr-2" />
								Run doctor
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => unlockRepo.mutate({ path: { id: repository.id } })}
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

				<div>
					<h3 className="text-lg font-semibold mb-4">Current Configuration</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<div className="text-sm font-medium text-muted-foreground">Name</div>
							<p className="mt-1 text-sm">{repository.name}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Compression mode</div>
							<p className="mt-1 text-sm">{repository.compressionMode || "off"}</p>
						</div>
					</div>
				</div>

				<div>
					<h3 className="text-lg font-semibold mb-4">Repository Information</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<div className="text-sm font-medium text-muted-foreground">Backend</div>
							<p className="mt-1 text-sm">{repository.type}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Status</div>
							<p className="mt-1 text-sm">{repository.status || "unknown"}</p>
						</div>
						{effectiveLocalPath && (
							<div>
								<div className="text-sm font-medium text-muted-foreground">Local path</div>
								<p className="mt-1 text-sm font-mono">{effectiveLocalPath}</p>
							</div>
						)}
						<div>
							<div className="text-sm font-medium text-muted-foreground">Created at</div>
							<p className="mt-1 text-sm">{formatDateTime(repository.createdAt)}</p>
						</div>
						<div>
							<div className="text-sm font-medium text-muted-foreground">Last checked</div>
							<p className="mt-1 text-sm">{formatTimeAgo(repository.lastChecked)}</p>
						</div>
						{config.cacert && (
							<div>
								<div className="text-sm font-medium text-muted-foreground">CA Certificate</div>
								<p className="mt-1 text-sm">
									<span className="text-green-500">configured</span>
								</p>
							</div>
						)}
						{"insecureTls" in config && (
							<div>
								<div className="text-sm font-medium text-muted-foreground">TLS Certificate Validation</div>
								<p className="mt-1 text-sm">
									{config.insecureTls ? (
										<span className="text-red-500">disabled</span>
									) : (
										<span className="text-green-500">enabled</span>
									)}
								</p>
							</div>
						)}
					</div>
				</div>

				{repository.lastError && (
					<div>
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-semibold text-red-500">Last Error</h3>
						</div>
						<div className="bg-red-500/10 border border-red-500/20 rounded-md p-4">
							<p className="text-sm text-red-500 wrap-break-word">{repository.lastError}</p>
						</div>
					</div>
				)}

				<div>
					<h3 className="text-lg font-semibold mb-4">Configuration</h3>
					<div className="bg-muted/50 rounded-md p-4">
						<pre className="text-sm overflow-auto">{JSON.stringify(repository.config, null, 2)}</pre>
					</div>
				</div>

				<DoctorReport repositoryStatus={repository.status} result={repository.doctorResult} />
			</Card>

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
