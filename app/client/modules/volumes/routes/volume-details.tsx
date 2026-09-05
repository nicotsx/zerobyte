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
import { getRemoteSourcePresentation } from "../source-presentation";

export function VolumeDetails({ volumeId }: { volumeId: string }) {
	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/(dashboard)/volumes/$volumeId/" });
	const activeTab = searchParams.tab || "info";
	const { formatDateTime, formatTimeAgo } = useTimeFormat();

	const { data } = useSuspenseQuery({
		...getVolumeOptions({ path: { shortId: volumeId } }),
	});

	const { volume, statfs } = data;
	const isRemoteSource = volume.sourceKind === "agent-filesystem";
	const remotePresentation = isRemoteSource ? getRemoteSourcePresentation(volume) : null;

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
			toast.success("Source deleted successfully");
			void navigate({ to: "/volumes" });
		},
		onError: (error) => {
			toast.error("Failed to delete source", {
				description: parseError(error)?.message,
			});
		},
	});

	const healthcheck = useMutation({
		...healthCheckVolumeMutation(),
		onSuccess: (d) => {
			if (d.error) {
				const description = isRemoteSource
					? "The source could not be reached. Review its availability details."
					: d.error;
				toast.error(isRemoteSource ? "Source unavailable" : "Health check failed", { description });
				return;
			}
			if (isRemoteSource) {
				toast.success("Availability checked", { description: "The source is available." });
				return;
			}
			toast.success("Health check completed", { description: "The source is healthy." });
		},
		onError: (error) => {
			const description = isRemoteSource
				? "The source could not be reached. Review its availability details."
				: error.message;
			toast.error(isRemoteSource ? "Availability check failed" : "Health check failed", { description });
		},
	});

	const toggleAutoRemount = useMutation({
		...updateVolumeMutation(),
		onSuccess: (d) => {
			toast.success("Source updated", {
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

	const isDirectory = volume.type === "directory";
	const isMounted = volume.status === "mounted";
	const isError = volume.status === "error";
	const isUnmounted = volume.status === "unmounted";
	const displayStatus = remotePresentation?.status ?? volume.status;
	const informationTabLabel = isRemoteSource ? "Information" : "Configuration";

	return (
		<>
			<div className="flex flex-col gap-6 @container">
				<Card className="px-6 py-5">
					<div className="flex flex-col @wide:flex-row @wide:items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-4">
							<div className="hidden @medium:flex items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-muted/50 border border-border/50">
								<HardDrive className="h-5 w-5 text-muted-foreground" />
							</div>
							<div className="min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<h2 className="text-balance text-lg font-semibold tracking-tight">{volume.name}</h2>
									<Separator orientation="vertical" className="h-4 mx-1" />
									<Badge variant="outline" className="capitalize gap-1.5">
										<span
											className={cn("w-2 h-2 rounded-full shrink-0", {
												"bg-success": remotePresentation
													? remotePresentation.statusVariant === "success"
													: isMounted,
												"bg-red-500": remotePresentation
													? remotePresentation.statusVariant === "error"
													: isError,
												"bg-amber-500": remotePresentation
													? remotePresentation.statusVariant === "warning"
													: isUnmounted,
												"bg-gray-500": remotePresentation?.statusVariant === "neutral",
											})}
										/>
										{displayStatus}
									</Badge>
									{!isRemoteSource && <Badge variant="secondary">{volume.type}</Badge>}
									{volume.provisioningId && <ManagedBadge />}
								</div>
								{remotePresentation && (
									<p className="mt-0.5 max-w-[60ch] break-words text-pretty text-sm text-muted-foreground">
										{remotePresentation.context}
									</p>
								)}
								<p className="text-sm text-muted-foreground mt-0.5">
									Created {formatDateTime(volume.createdAt)}
								</p>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{!isRemoteSource && !isDirectory && (
								<Button
									className={cn({ hidden: !isMounted })}
									variant="secondary"
									onClick={() =>
										toast.promise(unmountVol.mutateAsync({ path: { shortId: volume.shortId } }), {
											loading: "Unmounting source...",
											success: "Source unmounted successfully",
											error: (error) => parseError(error)?.message || "Failed to unmount source",
										})
									}
									loading={unmountVol.isPending}
								>
									<Unplug className="h-4 w-4 mr-2" />
									Unmount
								</Button>
							)}
							{!isRemoteSource && !isDirectory && (
								<Button
									className={cn({ hidden: isMounted })}
									onClick={() =>
										toast.promise(mountVol.mutateAsync({ path: { shortId: volume.shortId } }), {
											loading: "Mounting source...",
											success: "Source mounted successfully",
											error: (error) => parseError(error)?.message || "Failed to mount source",
										})
									}
									loading={mountVol.isPending}
								>
									<Plug className="h-4 w-4 mr-2" />
									Mount
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
									<DropdownMenuItem
										onClick={() => navigate({ to: `/volumes/${volume.shortId}/edit` })}
									>
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
					{remotePresentation ? (
						<div className="flex flex-col justify-between gap-3 @lg:flex-row @lg:items-center">
							<div className="min-w-0 space-y-1">
								<div className="flex flex-wrap items-center gap-2">
									<HeartIcon className="h-4 w-4 text-muted-foreground" />
									<span className="text-sm font-medium">Availability</span>
									<Badge
										variant={
											remotePresentation.statusVariant === "error"
												? "destructive"
												: remotePresentation.statusVariant === "neutral"
													? "secondary"
													: "outline"
										}
										className={cn("ml-1", {
											"text-success border-success/30 bg-success/10":
												remotePresentation.statusVariant === "success",
											"text-amber-500 border-amber-500/30 bg-amber-500/10":
												remotePresentation.statusVariant === "warning",
										})}
									>
										{remotePresentation.status}
									</Badge>
								</div>
								<p className="text-pretty text-sm text-muted-foreground">
									{remotePresentation.explanation}
								</p>
								<p className="text-xs text-muted-foreground">
									Checked {formatTimeAgo(volume.lastHealthCheck)}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								loading={healthcheck.isPending}
								onClick={() => healthcheck.mutate({ path: { shortId: volume.shortId } })}
							>
								<Activity className="h-4 w-4 mr-2" />
								Check availability
							</Button>
						</div>
					) : (
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
										className={cn("text-success border-success/30 bg-success/10 ml-1", {
											hidden: !isMounted,
										})}
									>
										Healthy
									</Badge>
									<Badge variant="secondary" className={cn("ml-1", { hidden: isMounted || isError })}>
										Unmounted
									</Badge>
								</div>
								<Separator orientation="vertical" className="h-4 hidden @lg:block" />
								<span className="text-sm text-muted-foreground">
									Checked {formatTimeAgo(volume.lastHealthCheck)}
								</span>
								{!isDirectory && (
									<>
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
									</>
								)}
							</div>
							<Button
								variant="outline"
								size="sm"
								className="shrink-0"
								disabled={!isDirectory && volume.status === "unmounted"}
								loading={healthcheck.isPending}
								onClick={() => healthcheck.mutate({ path: { shortId: volume.shortId } })}
							>
								<Activity className="h-4 w-4 mr-2" />
								Check Now
							</Button>
						</div>
					)}
				</Card>

				{!isRemoteSource && volume.lastError && (
					<Card className="px-6 py-6">
						<div className="space-y-2">
							<p className="text-sm font-medium text-destructive">Last Error</p>
							<p className="text-sm text-muted-foreground wrap-break-word">{volume.lastError}</p>
						</div>
					</Card>
				)}

				<Tabs
					value={activeTab}
					onValueChange={(value) => navigate({ to: ".", search: () => ({ tab: value }) })}
				>
					<TabsList className="mb-2">
						<TabsTrigger value="info">{informationTabLabel}</TabsTrigger>
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
						<AlertDialogTitle>Delete source?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the source <strong>{volume.name}</strong>? This action
							cannot be undone.
							<br />
							<br />
							All backup schedules associated with this source will also be removed.
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
							Delete source
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
