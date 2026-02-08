import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";

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
import type { VolumeStatus } from "~/client/lib/types";
import {
	deleteVolumeMutation,
	getVolumeOptions,
	mountVolumeMutation,
	unmountVolumeMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { useNavigate } from "@tanstack/react-router";

const getVolumeStatusVariant = (status: VolumeStatus): "success" | "neutral" | "error" | "warning" => {
	const statusMap = {
		mounted: "success" as const,
		unmounted: "neutral" as const,
		error: "error" as const,
		unknown: "warning" as const,
	};
	return statusMap[status];
};

export function VolumeDetails({ volumeId }: { volumeId: string }) {
	const navigate = useNavigate();
	const searchParams = useSearch({ from: "/(dashboard)/volumes/$volumeId" });

	const activeTab = searchParams.tab || "info";

	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const { data } = useSuspenseQuery({
		...getVolumeOptions({ path: { id: volumeId } }),
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
		deleteVol.mutate({ path: { id: volumeId } });
	};

	if (!volumeId) {
		return <div>Volume not found</div>;
	}

	if (!data) {
		return <div>Loading...</div>;
	}

	const { volume, statfs } = data;

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
						onClick={() => mountVol.mutate({ path: { id: volumeId } })}
						loading={mountVol.isPending}
						className={cn({ hidden: volume.status === "mounted" })}
					>
						<Plug className="h-4 w-4 mr-2" />
						Mount
					</Button>
					<Button
						variant="secondary"
						onClick={() => unmountVol.mutate({ path: { id: volumeId } })}
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
			<Tabs
				value={activeTab}
				onValueChange={(value) => navigate({ to: ".", search: () => ({ tab: value }) })}
				className="mt-4"
			>
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

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete volume?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the volume <strong>{volume.name}</strong>? This action cannot be undone.
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
