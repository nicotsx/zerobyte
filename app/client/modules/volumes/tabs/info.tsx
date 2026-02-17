import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Plug, Trash2, Unplug } from "lucide-react";
import { CreateVolumeForm, type FormValues } from "~/client/modules/volumes/components/create-volume-form";
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
import type { StatFs, Volume } from "~/client/lib/types";
import { HealthchecksCard } from "../components/healthchecks-card";
import { StorageChart } from "../components/storage-chart";
import {
	deleteVolumeMutation,
	mountVolumeMutation,
	unmountVolumeMutation,
	updateVolumeMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { UpdateVolumeResponse } from "~/client/api-client/types.gen";
import { useNavigate } from "@tanstack/react-router";
import { parseError } from "~/client/lib/errors";

type Props = {
	volume: Volume;
	statfs: StatFs;
};

export const VolumeInfoTabContent = ({ volume, statfs }: Props) => {
	const navigate = useNavigate();

	const updateMutation = useMutation({
		...updateVolumeMutation(),
		onSuccess: (data: UpdateVolumeResponse) => {
			toast.success("Volume updated successfully");
			setOpen(false);
			setPendingValues(null);

			if (data.name !== volume.name) {
				void navigate({ to: `/volumes/${data.shortId}` });
			}
		},
		onError: (error) => {
			toast.error("Failed to update volume", { description: error.message });
			setOpen(false);
			setPendingValues(null);
		},
	});

	const mountVol = useMutation({
		...mountVolumeMutation(),
		onSuccess: () => {
			toast.success("Volume mounted successfully");
		},
		onError: (error) => {
			toast.error("Failed to mount volume", {
				description: parseError(error)?.message,
			});
		},
	});

	const unmountVol = useMutation({
		...unmountVolumeMutation(),
		onSuccess: () => {
			toast.success("Volume unmounted successfully");
		},
		onError: (error) => {
			toast.error("Failed to unmount volume", {
				description: parseError(error)?.message,
			});
		},
	});

	const deleteVol = useMutation({
		...deleteVolumeMutation(),
		onSuccess: () => {
			toast.success("Volume deleted successfully");
			void navigate({ to: "/volumes" });
		},
		onError: (error) => {
			toast.error("Failed to delete volume", {
				description: parseError(error)?.message,
			});
		},
	});

	const [open, setOpen] = useState(false);
	const [pendingValues, setPendingValues] = useState<FormValues | null>(null);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const handleSubmit = (values: FormValues) => {
		setPendingValues(values);
		setOpen(true);
	};

	const confirmUpdate = () => {
		if (pendingValues) {
			updateMutation.mutate({
				path: { id: volume.shortId },
				body: { name: pendingValues.name, config: pendingValues },
			});
		}
	};

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteVol.mutate({ path: { id: volume.shortId } });
	};

	return (
		<>
			<div className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]">
				<Card className="p-6 @container">
					<div className="flex flex-col @xl:flex-row items-start @xl:items-center justify-between gap-4 mb-6">
						<div>
							<span className="text-lg font-semibold">Volume Configuration</span>
						</div>
						<div className="flex flex-col @xl:flex-row w-full @xl:w-auto gap-2">
							{volume.status !== "mounted" ? (
								<Button
									type="button"
									onClick={() => mountVol.mutate({ path: { id: volume.shortId } })}
									loading={mountVol.isPending}
								>
									<Plug className="h-4 w-4 mr-2" />
									Mount
								</Button>
							) : (
								<Button
									type="button"
									variant="secondary"
									onClick={() => unmountVol.mutate({ path: { id: volume.shortId } })}
									loading={unmountVol.isPending}
								>
									<Unplug className="h-4 w-4 mr-2" />
									Unmount
								</Button>
							)}
							<Button
								type="button"
								variant="destructive"
								onClick={() => setShowDeleteConfirm(true)}
								disabled={deleteVol.isPending}
							>
								<Trash2 className="h-4 w-4 mr-2" />
								Delete
							</Button>
						</div>
					</div>
					<CreateVolumeForm
						initialValues={{ ...volume, ...volume.config }}
						onSubmit={handleSubmit}
						mode="update"
						loading={updateMutation.isPending}
					/>
				</Card>
				<div className="flex flex-col gap-4">
					<div className="self-start w-full">
						<HealthchecksCard volume={volume} />
					</div>
					<div className="flex-1 w-full">
						<StorageChart statfs={statfs} />
					</div>
				</div>
			</div>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Update Volume Configuration</AlertDialogTitle>
						<AlertDialogDescription>
							Editing the volume will remount it with the new config immediately. This may temporarily disrupt access to
							the volume. Continue?
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={confirmUpdate}>
							<Check className="h-4 w-4" />
							Update
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
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
