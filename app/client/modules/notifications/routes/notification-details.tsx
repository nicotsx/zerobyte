import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState, useId } from "react";
import {
	deleteNotificationDestinationMutation,
	getNotificationDestinationOptions,
	testNotificationDestinationMutation,
	updateNotificationDestinationMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
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
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { Bell, Save, TestTube2, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { CreateNotificationForm, type NotificationFormValues } from "../components/create-notification-form";
import { useNavigate } from "@tanstack/react-router";

// export const handle = {
// 	breadcrumb: (match: Route.MetaArgs) => [
// 		{ label: "Notifications", href: "/notifications" },
// 		{ label: match.params.id },
// 	],
// };

export function NotificationDetailsPage({ notificationId }: { notificationId: string }) {
	const navigate = useNavigate();
	const formId = useId();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const { data } = useSuspenseQuery({
		...getNotificationDestinationOptions({ path: { id: notificationId } }),
	});

	const deleteDestination = useMutation({
		...deleteNotificationDestinationMutation(),
		onSuccess: () => {
			toast.success("Notification destination deleted successfully");
			void navigate({ to: "/notifications" });
		},
		onError: (error) => {
			toast.error("Failed to delete notification destination", {
				description: parseError(error)?.message,
			});
		},
	});

	const updateDestination = useMutation({
		...updateNotificationDestinationMutation(),
		onSuccess: () => {
			toast.success("Notification destination updated successfully");
		},
		onError: (error) => {
			toast.error("Failed to update notification destination", {
				description: parseError(error)?.message,
			});
		},
	});

	const testDestination = useMutation({
		...testNotificationDestinationMutation(),
		onSuccess: () => {
			toast.success("Test notification sent successfully");
		},
		onError: (error) => {
			toast.error("Failed to send test notification", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteDestination.mutate({ path: { id: String(data.id) } });
	};

	const handleSubmit = (values: NotificationFormValues) => {
		updateDestination.mutate({
			path: { id: String(data.id) },
			body: {
				name: values.name,
				config: values,
			},
		});
	};

	const handleTest = () => {
		testDestination.mutate({ path: { id: String(data.id) } });
	};

	return (
		<>
			<div className="flex items-center justify-between mb-4">
				<div className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
					<span
						className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-gray-500/10 text-gray-500", {
							"bg-green-500/10 text-green-500": data.enabled,
							"bg-red-500/10 text-red-500": !data.enabled,
						})}
					>
						{data.enabled ? "Enabled" : "Disabled"}
					</span>
					<span className="text-xs bg-primary/10 rounded-md px-2 py-1 capitalize">{data.type}</span>
				</div>
				<div className="flex gap-2">
					<Button
						onClick={handleTest}
						disabled={testDestination.isPending || !data.enabled}
						variant="outline"
						loading={testDestination.isPending}
					>
						<TestTube2 className="h-4 w-4 mr-2" />
						Test
					</Button>
					<Button
						onClick={() => setShowDeleteConfirm(true)}
						variant="destructive"
						loading={deleteDestination.isPending}
					>
						<Trash2 className="h-4 w-4 mr-2" />
						Delete
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<Bell className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>{data.name}</CardTitle>
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
						<Button type="submit" form={formId} loading={updateDestination.isPending}>
							<Save className="h-4 w-4 mr-2" />
							Save Changes
						</Button>
					</div>
				</CardContent>
			</Card>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete Notification Destination</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the notification destination "{data.name}"? This action cannot be undone
							and will remove this destination from all backup schedules.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmDelete}>
							<Trash2 className="h-4 w-4 mr-2" />
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
