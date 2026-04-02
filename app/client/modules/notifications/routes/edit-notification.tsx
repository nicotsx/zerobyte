import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bell, Save } from "lucide-react";
import { toast } from "sonner";
import {
	getNotificationDestinationOptions,
	updateNotificationDestinationMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { CreateNotificationForm, type NotificationFormValues } from "../components/create-notification-form";

export function EditNotificationPage({ notificationId }: { notificationId: string }) {
	const navigate = useNavigate();
	const formId = useId();

	const { data } = useSuspenseQuery({
		...getNotificationDestinationOptions({ path: { id: notificationId } }),
	});

	const updateDestination = useMutation({
		...updateNotificationDestinationMutation(),
		onSuccess: () => {
			toast.success("Notification destination updated successfully");
			void navigate({ to: `/notifications/${data.id}` });
		},
		onError: (error) => {
			toast.error("Failed to update notification destination", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleSubmit = (values: NotificationFormValues) => {
		updateDestination.mutate({
			path: { id: String(data.id) },
			body: {
				name: values.name,
				config: values,
			},
		});
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<Bell className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Edit Notification Destination</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{updateDestination.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to update notification destination:</strong>
								<br />
								{parseError(updateDestination.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateNotificationForm
						mode="update"
						formId={formId}
						onSubmit={handleSubmit}
						initialValues={{
							...data.config,
							name: data.name,
						}}
					/>
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate({ to: `/notifications/${data.id}` })}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={updateDestination.isPending}>
							<Save className="h-4 w-4 mr-2" />
							Save Changes
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
