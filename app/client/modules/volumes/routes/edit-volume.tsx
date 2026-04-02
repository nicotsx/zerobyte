import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { HardDrive, Check, Save } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { getVolumeOptions, updateVolumeMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { type UpdateVolumeResponse } from "~/client/api-client/types.gen";
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
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { useNavigate } from "@tanstack/react-router";
import { ManagedBadge } from "~/client/components/managed-badge";
import { CreateVolumeForm, formSchema, type FormValues } from "../components/create-volume-form";

export function EditVolumePage({ volumeId }: { volumeId: string }) {
	const navigate = useNavigate();
	const formId = useId();
	const [open, setOpen] = useState(false);
	const [pendingValues, setPendingValues] = useState<FormValues | null>(null);

	const { data } = useSuspenseQuery({
		...getVolumeOptions({ path: { shortId: volumeId } }),
	});

	const { volume } = data;

	const updateVolume = useMutation({
		...updateVolumeMutation(),
		onSuccess: (updatedVolume: UpdateVolumeResponse) => {
			toast.success("Volume updated successfully");
			setOpen(false);
			setPendingValues(null);
			void navigate({ to: `/volumes/${updatedVolume.shortId}` });
		},
		onError: (error) => {
			toast.error("Failed to update volume", {
				description: parseError(error)?.message,
			});
			setOpen(false);
			setPendingValues(null);
		},
	});

	const handleSubmit = (values: FormValues) => {
		setPendingValues(values);
		setOpen(true);
	};

	const confirmUpdate = () => {
		if (!pendingValues) {
			return;
		}

		const { name, ...config } = formSchema.parse(pendingValues);

		updateVolume.mutate({
			path: { shortId: volume.shortId },
			body: { name, config },
		});
	};

	return (
		<>
			<div className="container mx-auto space-y-6">
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
								<HardDrive className="w-5 h-5 text-primary" />
							</div>
							<div className="flex items-center gap-2">
								<CardTitle>Edit Volume</CardTitle>
								{volume.provisioningId && <ManagedBadge />}
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-6">
						{updateVolume.isError && (
							<Alert variant="destructive">
								<AlertDescription>
									<strong>Failed to update volume:</strong>
									<br />
									{parseError(updateVolume.error)?.message}
								</AlertDescription>
							</Alert>
						)}
						<CreateVolumeForm
							mode="update"
							formId={formId}
							initialValues={{ ...volume, ...volume.config }}
							onSubmit={handleSubmit}
							loading={updateVolume.isPending}
						/>
						<div className="flex justify-end gap-2 pt-4 border-t">
							<Button type="button" variant="secondary" onClick={() => navigate({ to: `/volumes/${volume.shortId}` })}>
								Cancel
							</Button>
							<Button type="submit" form={formId} loading={updateVolume.isPending}>
								<Save className="h-4 w-4 mr-2" />
								Save changes
							</Button>
						</div>
					</CardContent>
				</Card>
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
						<AlertDialogAction onClick={confirmUpdate} disabled={updateVolume.isPending}>
							<Check className="h-4 w-4" />
							Update
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
