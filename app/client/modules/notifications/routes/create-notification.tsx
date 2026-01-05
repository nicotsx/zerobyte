import { useMutation } from "@tanstack/react-query";
import { Bell, Plus } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { createNotificationDestinationMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import type { Route } from "./+types/create-notification";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { CreateNotificationForm, type NotificationFormValues } from "../components/create-notification-form";

export const handle = {
	breadcrumb: () => [{ label: "Notifications", href: "/notifications" }, { label: "Create" }],
};

export function meta(_: Route.MetaArgs) {
	return [
		{ title: "Zerobyte - Create Notification" },
		{
			name: "description",
			content: "Create a new notification destination for backup alerts.",
		},
	];
}

export default function CreateNotification() {
	const navigate = useNavigate();
	const formId = useId();

	const createNotification = useMutation({
		...createNotificationDestinationMutation(),
		onSuccess: () => {
			toast.success("Notification destination created successfully");
			void navigate(`/notifications`);
		},
	});

	const handleSubmit = (values: NotificationFormValues) => {
		createNotification.mutate({ body: { name: values.name, config: values } });
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<Bell className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Create Notification Destination</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{createNotification.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create notification destination:</strong>
								<br />
								{parseError(createNotification.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateNotificationForm mode="create" formId={formId} onSubmit={handleSubmit} />
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate("/notifications")}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={createNotification.isPending}>
							<Plus className="h-4 w-4 mr-2" />
							Create Destination
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
