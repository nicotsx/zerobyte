import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";
import {
	deleteNotificationDestinationMutation,
	getNotificationDestinationOptions,
	testNotificationDestinationMutation,
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import { Badge } from "~/client/components/ui/badge";
import { Card, CardTitle } from "~/client/components/ui/card";
import { Separator } from "~/client/components/ui/separator";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import {
	Bell,
	Bot,
	ChevronDown,
	Globe,
	Hash,
	Key,
	Link,
	Lock,
	Mail,
	AtSign,
	MessageSquare,
	Pencil,
	Server,
	Settings,
	Shield,
	Smile,
	TestTube2,
	Trash2,
	Users,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { GetNotificationDestinationResponse } from "~/client/api-client/types.gen";
import { useTimeFormat } from "~/client/lib/datetime";

type NotificationConfig = GetNotificationDestinationResponse["config"];
type Props = {
	icon: React.ReactNode;
	label: string;
	value: string;
	mono?: boolean;
};

function ConfigRow({ icon, label, value, mono }: Props) {
	return (
		<div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
			<span className="text-muted-foreground shrink-0">{icon}</span>
			<span className="text-sm text-muted-foreground w-40 shrink-0">{label}</span>
			<span className={cn("text-sm break-all", { "font-mono bg-muted/50 px-2 py-0.5 rounded": mono })}>{value}</span>
		</div>
	);
}

function NotificationConfigRows({ config }: { config: NotificationConfig }) {
	switch (config.type) {
		case "slack":
			return (
				<>
					<ConfigRow icon={<Globe className="h-4 w-4" />} label="Webhook URL" value={config.webhookUrl} mono />
					<ConfigRow icon={<Hash className="h-4 w-4" />} label="Channel" value={config.channel || "—"} />
					<ConfigRow icon={<Bot className="h-4 w-4" />} label="Bot Username" value={config.username || "—"} />
					<ConfigRow icon={<Smile className="h-4 w-4" />} label="Icon Emoji" value={config.iconEmoji || "—"} />
				</>
			);
		case "discord":
			return (
				<>
					<ConfigRow icon={<Globe className="h-4 w-4" />} label="Webhook URL" value={config.webhookUrl} mono />
					<ConfigRow icon={<Bot className="h-4 w-4" />} label="Username" value={config.username || "—"} />
					<ConfigRow icon={<Link className="h-4 w-4" />} label="Avatar URL" value={config.avatarUrl || "—"} mono />
					<ConfigRow icon={<MessageSquare className="h-4 w-4" />} label="Thread ID" value={config.threadId || "—"} />
				</>
			);
		case "email":
			return (
				<>
					<ConfigRow icon={<Server className="h-4 w-4" />} label="SMTP Host" value={config.smtpHost} mono />
					<ConfigRow icon={<Server className="h-4 w-4" />} label="SMTP Port" value={String(config.smtpPort)} />
					<ConfigRow icon={<AtSign className="h-4 w-4" />} label="Username" value={config.username || "—"} />
					<ConfigRow icon={<Lock className="h-4 w-4" />} label="Password" value={config.password || "—"} />
					<ConfigRow icon={<Mail className="h-4 w-4" />} label="From" value={config.from} />
					{config.fromName && (
						<ConfigRow icon={<Mail className="h-4 w-4" />} label="From Name" value={config.fromName} />
					)}
					<ConfigRow icon={<Users className="h-4 w-4" />} label="To" value={config.to.join(", ")} />
					<ConfigRow icon={<Shield className="h-4 w-4" />} label="TLS" value={config.useTLS ? "Enabled" : "Disabled"} />
				</>
			);
		case "gotify":
			return (
				<>
					<ConfigRow icon={<Globe className="h-4 w-4" />} label="Server URL" value={config.serverUrl} mono />
					<ConfigRow icon={<Key className="h-4 w-4" />} label="Token" value={config.token} mono />
					<ConfigRow icon={<Globe className="h-4 w-4" />} label="Path" value={config.path || "—"} mono />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Priority" value={String(config.priority)} />
				</>
			);
		case "ntfy":
			return (
				<>
					<ConfigRow
						icon={<Globe className="h-4 w-4" />}
						label="Server URL"
						value={config.serverUrl || "Default (ntfy.sh)"}
						mono
					/>
					<ConfigRow icon={<Hash className="h-4 w-4" />} label="Topic" value={config.topic} />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Priority" value={config.priority} />
					<ConfigRow icon={<AtSign className="h-4 w-4" />} label="Username" value={config.username || "—"} />
					<ConfigRow icon={<Lock className="h-4 w-4" />} label="Password" value={config.password || "—"} />
					<ConfigRow icon={<Key className="h-4 w-4" />} label="Access Token" value={config.accessToken || "—"} />
				</>
			);
		case "pushover":
			return (
				<>
					<ConfigRow icon={<Key className="h-4 w-4" />} label="User Key" value={config.userKey} mono />
					<ConfigRow icon={<Key className="h-4 w-4" />} label="API Token" value={config.apiToken} mono />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Devices" value={config.devices || "—"} />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Priority" value={String(config.priority)} />
				</>
			);
		case "telegram":
			return (
				<>
					<ConfigRow icon={<Key className="h-4 w-4" />} label="Bot Token" value={config.botToken} mono />
					<ConfigRow icon={<Hash className="h-4 w-4" />} label="Chat ID" value={config.chatId} mono />
					<ConfigRow icon={<MessageSquare className="h-4 w-4" />} label="Thread ID" value={config.threadId || "—"} />
				</>
			);
		case "generic":
			return (
				<>
					<ConfigRow icon={<Globe className="h-4 w-4" />} label="URL" value={config.url} mono />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Method" value={config.method} />
					<ConfigRow icon={<Settings className="h-4 w-4" />} label="Content Type" value={config.contentType || "—"} />
					<ConfigRow
						icon={<Settings className="h-4 w-4" />}
						label="JSON Mode"
						value={config.useJson ? "Enabled" : "Disabled"}
					/>
					<ConfigRow icon={<Key className="h-4 w-4" />} label="Title Key" value={config.titleKey || "—"} mono />
					<ConfigRow icon={<Key className="h-4 w-4" />} label="Message Key" value={config.messageKey || "—"} mono />
					{config.headers?.map((h, i) => (
						<ConfigRow key={i} icon={<Link className="h-4 w-4" />} label={`Header ${i + 1}`} value={h} mono />
					))}
				</>
			);
		case "custom":
			return <ConfigRow icon={<Globe className="h-4 w-4" />} label="Shoutrrr URL" value={config.shoutrrrUrl} mono />;
	}
}

export function NotificationDetailsPage({ notificationId }: { notificationId: string }) {
	const navigate = useNavigate();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const { formatDateTime } = useTimeFormat();

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

	const handleTest = () => {
		testDestination.mutate({ path: { id: String(data.id) } });
	};

	return (
		<>
			<div className="flex flex-col gap-6 @container">
				<Card className="px-6 py-5">
					<div className="flex flex-col @wide:flex-row @wide:items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<div className="hidden @medium:flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-muted/50 border border-border/50">
								<Bell className="h-5 w-5 text-muted-foreground" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-lg font-semibold tracking-tight">{data.name}</h2>
									<Separator orientation="vertical" className="h-4 mx-1" />
									<Badge variant="outline" className="capitalize gap-1.5">
										<span
											className={cn("w-2 h-2 rounded-full shrink-0", {
												"bg-success": data.enabled,
												"bg-red-500": !data.enabled,
											})}
										/>
										{data.enabled ? "Enabled" : "Disabled"}
									</Badge>
									<Badge variant="secondary" className="capitalize">
										{data.type}
									</Badge>
								</div>
								<p className="text-sm text-muted-foreground mt-0.5">Created {formatDateTime(data.createdAt)}</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button
								onClick={handleTest}
								disabled={testDestination.isPending || !data.enabled}
								variant="outline"
								loading={testDestination.isPending}
							>
								<TestTube2 className="h-4 w-4 mr-2" />
								Test
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button variant="outline">
										Actions
										<ChevronDown className="h-4 w-4 ml-1" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => navigate({ to: `/notifications/${data.id}/edit` })}>
										<Pencil />
										Edit
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onClick={() => setShowDeleteConfirm(true)}
										disabled={deleteDestination.isPending}
									>
										<Trash2 />
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				</Card>

				<Card className="px-6 py-6">
					<CardTitle className="flex items-center gap-2 mb-5">
						<Settings className="h-4 w-4 text-muted-foreground" />
						Configuration
					</CardTitle>
					<div className="space-y-0 divide-y divide-border/50">
						<NotificationConfigRows config={data.config} />
					</div>
				</Card>
			</div>

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
