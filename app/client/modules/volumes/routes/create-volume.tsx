import { useMutation } from "@tanstack/react-query";
import { HardDrive, Plus } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { createVolumeMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { CreateVolumeForm, type FormValues } from "~/client/modules/volumes/components/create-volume-form";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";

export function CreateVolumePage() {
	const navigate = useNavigate();
	const formId = useId();

	const createVolume = useMutation({
		...createVolumeMutation(),
		onSuccess: (data) => {
			toast.success("Volume created successfully");
			void navigate({ to: `/volumes/${data.shortId}` });
		},
	});

	const handleSubmit = (values: FormValues) => {
		createVolume.mutate({
			body: {
				config: values,
				name: values.name,
			},
		});
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<HardDrive className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Create Volume</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{createVolume.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create volume:</strong>
								<br />
								{parseError(createVolume.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateVolumeForm mode="create" formId={formId} onSubmit={handleSubmit} loading={createVolume.isPending} />
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate({ to: "/volumes" })}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={createVolume.isPending}>
							<Plus className="h-4 w-4 mr-2" />
							Create Volume
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
