import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { CreateVolumeForm, type FormValues, toBackendConfig } from "~/client/modules/volumes/components/create-volume-form";
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
import { Card } from "~/client/components/ui/card";
import type { StatFs, Volume } from "~/client/lib/types";
import { HealthchecksCard } from "../components/healthchecks-card";
import { StorageChart } from "../components/storage-chart";
import { updateVolumeMutation } from "~/client/api-client/@tanstack/react-query.gen";
import type { UpdateVolumeResponse } from "~/client/api-client/types.gen";

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
				navigate(`/volumes/${data.name}`);
			}
		},
		onError: (error) => {
			toast.error("Failed to update volume", { description: error.message });
			setOpen(false);
			setPendingValues(null);
		},
	});

	const [open, setOpen] = useState(false);
	const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

	const handleSubmit = (values: FormValues) => {
		setPendingValues(values);
		setOpen(true);
	};

	const confirmUpdate = () => {
		if (pendingValues) {
			updateMutation.mutate({
				path: { name: volume.name },
				body: { name: pendingValues.name, config: toBackendConfig(pendingValues) },
			});
		}
	};

	return (
		<>
			<div className="grid gap-4 xl:grid-cols-[minmax(0,2.3fr)_minmax(320px,1fr)]">
				<Card className="p-6">
					<CreateVolumeForm
						initialValues={{ name: volume.name, ...volume.config }}
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
		</>
	);
};
