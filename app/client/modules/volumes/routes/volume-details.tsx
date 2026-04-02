import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Activity, ChevronDown, HardDrive, HeartIcon, Pencil, Plug, Trash2, Unplug } from "lucide-react";
import {
	deleteVolumeMutation,
	getVolumeOptions,
	healthCheckVolumeMutation,
	mountVolumeMutation,
	unmountVolumeMutation,
	updateVolumeMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
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
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import { Card } from "~/client/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import { Separator } from "~/client/components/ui/separator";
import { Switch } from "~/client/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { ManagedBadge } from "~/client/components/managed-badge";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import { VolumeInfoTabContent } from "../tabs/info";
import { FilesTabContent } from "../tabs/files";
import { useTimeFormat } from "~/client/lib/datetime";

export function VolumeDetails({ volumeId }: { volumeId: string }) {
	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/(dashboard)/volumes/$volumeId/" });
	const activeTab = searchParams.tab || "info";
	const { formatDateTime, formatTimeAgo } = useTimeFormat();

	const { data } = useSuspenseQuery({
		...getVolumeOptions({ path: { shortId: volumeId } }),
	});

	const { volume, statfs } = data;

	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const mountVol = useMutation({
		...mountVolumeMutation(),
	});

	const unmountVol = useMutation({
		...unmountVolumeMutation(),
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

	const healthcheck = useMutation({
		...healthCheckVolumeMutation(),
		onSuccess: (d) => {
			if (d.error) {
				toast.error("Health check failed", { description: d.error });
				return;
			}
			toast.success("Health check completed", { description: "The volume is healthy." });
		},
		onError: (error) => {
			toast.error("Health check failed", { description: error.message });
		},
	});

	const toggleAutoRemount = useMutation({
		...updateVolumeMutation(),
		onSuccess: (d) => {
			toast.success("Volume updated", {
				description: `Auto remount is now ${d.autoRemount ? "enabled" : "paused"}.`,
			});
		},
		onError: (error) => {
			toast.error("Update failed", { description: error.message });
		},
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteVol.mutate({ path: { shortId: volume.shortId } });
	};

	const isMounted = volume.status === "mounted";
	const isError = volume.status === "error";

	return (
		<>
			<div className="flex flex-col gap-6 @container">
				<Card className="px-6 py-5">
					<div className="flex flex-col @wide:flex-row @wide:items-center justify-between gap-4">
						<div className="flex items-center gap-4">
							<div className="hidden @medium:flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-muted/50 border border-border/50">
								<HardDrive className="h-5 w-5 text-muted-foreground" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<h2 className="text-lg font-semibold tracking-tight">{volume.name}</h2>
									<Separator orientation="vertical" className="h-4 mx-1" />
									<Badge variant="outline" className="capitalize gap-1.5">
										<span
											className={cn("w-2 h-2 rounded-full shrink-0", {
												"bg-success": volume.status === "mounted",
												"bg-red-500": volume.status === "error",
												"bg-amber-500": volume.status === "unmounted",
											})}
										/>
										{volume.status}
									</Badge>
									<Badge variant="secondary">{volume.type}</Badge>
									{volume.provisioningId && <ManagedBadge />}
								</div>
								<p className="text-sm text-muted-foreground mt-0.5">Created {formatDateTime(volume.createdAt)}</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Button
								className={cn({ hidden: !isMounted })}
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
							<Button
								className={cn({ hidden: isMounted })}
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
				</Card>

				<Card className="px-6 py-4">
					<div className="flex flex-col @lg:flex-row @lg:items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
							<div className="flex items-center gap-2">
								<HeartIcon className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm font-medium">Health</span>
								<Badge variant="destructive" className={cn("ml-1", { hidden: !isError })}>
									Error
								</Badge>
								<Badge
									variant="outline"
									className={cn("text-success border-success/30 bg-success/10 ml-1", { hidden: !isMounted })}
								>
									Healthy
								</Badge>
								<Badge variant="secondary" className={cn("ml-1", { hidden: isMounted || isError })}>
									Unmounted
								</Badge>
							</div>
							<Separator orientation="vertical" className="h-4 hidden @lg:block" />
							<span className="text-sm text-muted-foreground">Checked {formatTimeAgo(volume.lastHealthCheck)}</span>
							<Separator orientation="vertical" className="h-4 hidden @lg:block" />
							<div className="flex items-center gap-2">
								<span className="text-sm text-muted-foreground">Auto-remount</span>
								<Switch
									checked={volume.autoRemount}
									onCheckedChange={() =>
										toggleAutoRemount.mutate({
											path: { shortId: volume.shortId },
											body: { autoRemount: !volume.autoRemount },
										})
									}
									disabled={toggleAutoRemount.isPending}
								/>
							</div>
						</div>
						<Button
							variant="outline"
							size="sm"
							className="shrink-0"
							disabled={volume.status === "unmounted"}
							loading={healthcheck.isPending}
							onClick={() => healthcheck.mutate({ path: { shortId: volume.shortId } })}
						>
							<Activity className="h-4 w-4 mr-2" />
							Check Now
						</Button>
					</div>
				</Card>

				<Card className={cn("px-6 py-6", { hidden: !volume.lastError })}>
					<div className="space-y-2">
						<p className="text-sm font-medium text-destructive">Last Error</p>
						<p className="text-sm text-muted-foreground wrap-break-word">{volume.lastError}</p>
					</div>
				</Card>

				<Tabs value={activeTab} onValueChange={(value) => navigate({ to: ".", search: () => ({ tab: value }) })}>
					<TabsList className="mb-2">
						<TabsTrigger value="info">Configuration</TabsTrigger>
						<TabsTrigger value="files">Files</TabsTrigger>
					</TabsList>
					<TabsContent value="info">
						<VolumeInfoTabContent volume={volume} statfs={statfs} />
					</TabsContent>
					<TabsContent value="files">
						<FilesTabContent volume={volume} />
					</TabsContent>
				</Tabs>
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
}
