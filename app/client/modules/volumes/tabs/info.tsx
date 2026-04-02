import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Pencil, Plug, Trash2, Unplug } from "lucide-react";
import { CreateVolumeForm } from "~/client/modules/volumes/components/create-volume-form";
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
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import type { StatFs, Volume } from "~/client/lib/types";
import { HealthchecksCard } from "../components/healthchecks-card";
import { StorageChart } from "../components/storage-chart";
import {
	deleteVolumeMutation,
	mountVolumeMutation,
	unmountVolumeMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { useNavigate } from "@tanstack/react-router";
import { parseError } from "~/client/lib/errors";
import { ManagedBadge } from "~/client/components/managed-badge";

type Props = {
	volume: Volume;
	statfs: StatFs;
};

export const VolumeInfoTabContent = ({ volume, statfs }: Props) => {
	const navigate = useNavigate();

	const mountVol = useMutation({
		...mountVolumeMutation(),
	});

	const unmountVol = useMutation({
		...unmountVolumeMutation(),
	});

	const deleteVol = useMutation({
		...deleteVolumeMutation(),
		onSuccess: async () => {
			toast.success("Volume deleted successfully");
			await navigate({ to: "/volumes" });
		},
		onError: (error) => {
			toast.error("Failed to delete volume", {
				description: parseError(error)?.message,
			});
		},
	});

	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteVol.mutate({ path: { shortId: volume.shortId } });
	};

	const hasLastError = Boolean(volume.lastError);

	return (
		<>
			<div className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]">
				<div className="flex flex-col gap-4">
					<Card className="p-6 @container">
						<div className="flex flex-col @xl:flex-row items-start @xl:items-center justify-between gap-4 mb-6">
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-lg font-semibold tracking-tight">Volume Configuration</h2>
									{volume.provisioningId && <ManagedBadge />}
								</div>
							</div>
							<div className="flex items-center gap-2">
								{volume.status !== "mounted" ? (
									<Button
										type="button"
										onClick={() =>
											toast.promise(mountVol.mutateAsync({ path: { shortId: volume.shortId } }), {
												loading: "Mounting volume...",
												success: "Volume mounted successfully",
												error: (error) => parseError(error)?.message || "Failed to mount volume",
											})
										}
										loading={mountVol.isPending}
									>
										<Plug className="h-4 w-4 mr-2" />
										Mount
									</Button>
								) : (
									<Button
										type="button"
										variant="secondary"
										onClick={() =>
											toast.promise(unmountVol.mutateAsync({ path: { shortId: volume.shortId } }), {
												loading: "Unmounting volume...",
												success: "Volume unmounted successfully",
												error: (error) => parseError(error)?.message || "Failed to unmount volume",
											})
										}
										loading={unmountVol.isPending}
									>
										<Unplug className="h-4 w-4 mr-2" />
										Unmount
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
										<DropdownMenuItem onClick={() => navigate({ to: `/volumes/${volume.shortId}/edit` })}>
											<Pencil />
											Edit
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											onClick={() => setShowDeleteConfirm(true)}
											disabled={deleteVol.isPending}
										>
											<Trash2 />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
						<CreateVolumeForm
							initialValues={{ ...volume, ...volume.config }}
							onSubmit={() => {}}
							mode="update"
							readOnly
						/>
					</Card>
					{hasLastError && (
						<Card className="p-6">
							<div className="space-y-2">
								<p className="text-sm font-medium text-destructive">Last Error</p>
								<p className="text-sm text-muted-foreground wrap-break-word">{volume.lastError}</p>
							</div>
						</Card>
					)}
				</div>
				<div className="flex flex-col gap-4">
					<div className="self-start w-full">
						<HealthchecksCard volume={volume} />
					</div>
					<div className="flex-1 w-full">
						<StorageChart statfs={statfs} />
					</div>
				</div>
			</div>
			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete volume?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the volume <strong>{volume.name}</strong>? This action cannot be undone.
							<br />
							<br />
							All backup schedules associated with this volume will also be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={deleteVol.isPending}
						>
							<Trash2 className="h-4 w-4 mr-2" />
							Delete volume
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
};
