import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useState } from "react";
import { Plug, Unplug } from "lucide-react";
import { StatusDot } from "~/client/components/status-dot";
import { Button } from "~/client/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { VolumeIcon } from "~/client/components/volume-icon";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import type { Route } from "./+types/volume-details";
import { VolumeInfoTabContent } from "../tabs/info";
import { FilesTabContent } from "../tabs/files";
import { DockerTabContent } from "../tabs/docker";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { getVolume } from "~/client/api-client";
import type { VolumeStatus } from "~/client/lib/types";
import {
	deleteVolumeMutation,
	getVolumeOptions,
	mountVolumeMutation,
	unmountVolumeMutation,
} from "~/client/api-client/@tanstack/react-query.gen";

const getVolumeStatusVariant = (status: VolumeStatus): "success" | "neutral" | "error" | "warning" => {
	const statusMap = {
		mounted: "success" as const,
		unmounted: "neutral" as const,
		error: "error" as const,
		unknown: "warning" as const,
	};
	return statusMap[status];
};

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [{ label: "Volumes", href: "/volumes" }, { label: match.params.name }],
};

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - ${params.name}` },
		{
			name: "description",
			content: "View and manage volume details, configuration, and files.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const volume = await getVolume({ path: { name: params.name } });
	if (volume.data) return volume.data;
};

export default function VolumeDetails({ loaderData }: Route.ComponentProps) {
	const { name } = useParams<{ name: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = searchParams.get("tab") || "info";
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const { data } = useQuery({
		...getVolumeOptions({ path: { name: name ?? "" } }),
		initialData: loaderData,
	});

	const { capabilities } = useSystemInfo();

	const deleteVol = useMutation({
		...deleteVolumeMutation(),
		onSuccess: () => {
			toast.success("Volume deleted successfully");
			navigate("/volumes");
		},
		onError: (error) => {
			toast.error("Failed to delete volume", {
				description: parseError(error)?.message,
			});
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

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteVol.mutate({ path: { name: name ?? "" } });
	};

	if (!name) {
		return <div>Volume not found</div>;
	}

	if (!data) {
		return <div>Loading...</div>;
	}

	const { volume, statfs } = data;
	const dockerAvailable = capabilities.docker;

	return (
		<>
			<div className="flex flex-col items-start xs:items-center xs:flex-row xs:justify-between">
				<div className="text-sm font-semibold mb-2 xs:mb-0 text-muted-foreground flex items-center gap-2">
					<span className="flex items-center gap-2">
						<StatusDot
							variant={getVolumeStatusVariant(volume.status)}
							label={volume.status[0].toUpperCase() + volume.status.slice(1)}
						/>
						&nbsp;
						{volume.status[0].toUpperCase() + volume.status.slice(1)}
					</span>
					<VolumeIcon backend={volume?.config.backend} />
				</div>
				<div className="flex gap-4">
					<Button
						onClick={() => mountVol.mutate({ path: { name } })}
						loading={mountVol.isPending}
						className={cn({ hidden: volume.status === "mounted" })}
					>
						<Plug className="h-4 w-4 mr-2" />
						Mount
					</Button>
					<Button
						variant="secondary"
						onClick={() => unmountVol.mutate({ path: { name } })}
						loading={unmountVol.isPending}
						className={cn({ hidden: volume.status !== "mounted" })}
					>
						<Unplug className="h-4 w-4 mr-2" />
						Unmount
					</Button>
					<Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} disabled={deleteVol.isPending}>
						Delete
					</Button>
				</div>
			</div>
			<Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })} className="mt-4">
				<TabsList className="mb-2">
					<TabsTrigger value="info">Configuration</TabsTrigger>
					<TabsTrigger value="files">Files</TabsTrigger>
					<Tooltip>
						<TooltipTrigger>
							<TabsTrigger disabled={!dockerAvailable} value="docker">
								Docker
							</TabsTrigger>
						</TooltipTrigger>
						<TooltipContent className={cn({ hidden: dockerAvailable })}>
							<p>Enable Docker support to access this tab.</p>
						</TooltipContent>
					</Tooltip>
				</TabsList>
				<TabsContent value="info">
					<VolumeInfoTabContent volume={volume} statfs={statfs} />
				</TabsContent>
				<TabsContent value="files">
					<FilesTabContent volume={volume} />
				</TabsContent>
				{dockerAvailable && (
					<TabsContent value="docker">
						<DockerTabContent volume={volume} />
					</TabsContent>
				)}
			</Tabs>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete volume?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the volume <strong>{name}</strong>? This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete volume
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
