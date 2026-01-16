import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { redirect, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
	cancelDoctorMutation,
	deleteRepositoryMutation,
	getRepositoryOptions,
	listSnapshotsOptions,
	startDoctorMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { parseError } from "~/client/lib/errors";
import { getRepository } from "~/client/api-client/sdk.gen";
import type { Route } from "./+types/repository-details";
import { cn } from "~/client/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import { RepositoryInfoTabContent } from "../tabs/info";
import { RepositorySnapshotsTabContent } from "../tabs/snapshots";
import { Square, Stethoscope, Trash2 } from "lucide-react";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.loaderData?.name || match.params.id },
	],
};

export function meta({ params, loaderData }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - ${loaderData?.name || params.id}` },
		{
			name: "description",
			content: "View repository configuration, status, and snapshots.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const repository = await getRepository({ path: { id: params.id ?? "" } });
	if (repository.data) return repository.data;

	return redirect("/repositories");
};

export default function RepositoryDetailsPage({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = searchParams.get("tab") || "info";

	const { data } = useQuery({
		...getRepositoryOptions({ path: { id: loaderData.id } }),
		initialData: loaderData,
	});

	useEffect(() => {
		void queryClient.prefetchQuery(listSnapshotsOptions({ path: { id: data.id } }));
	}, [queryClient, data.id]);

	const deleteRepo = useMutation({
		...deleteRepositoryMutation(),
		onSuccess: () => {
			toast.success("Repository deleted successfully");
			void navigate("/repositories");
		},
		onError: (error) => {
			toast.error("Failed to delete repository", {
				description: parseError(error)?.message,
			});
		},
	});

	const startDoctor = useMutation({
		...startDoctorMutation(),
		onError: (error) => {
			toast.error("Failed to start doctor", {
				description: parseError(error)?.message,
			});
		},
	});

	const cancelDoctor = useMutation({
		...cancelDoctorMutation(),
		onSuccess: () => {
			toast.info("Doctor operation cancelled");
		},
		onError: (error) => {
			toast.error("Failed to cancel doctor", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteRepo.mutate({ path: { id: data.id } });
	};

	return (
		<>
			<div className="flex items-center justify-between mb-4">
				<div className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
					<span
						className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-gray-500/10 text-gray-500", {
							"bg-green-500/10 text-green-500": data.status === "healthy",
							"bg-red-500/10 text-red-500": data.status === "error",
							"bg-blue-500/10 text-blue-500": data.status === "doctor",
						})}
					>
						{data.status || "unknown"}
					</span>
					<span className="text-xs bg-primary/10 rounded-md px-2 py-1">{data.type}</span>
				</div>
				<div className="flex gap-4">
					{data.status === "doctor" ? (
						<Button variant="destructive" onClick={() => cancelDoctor.mutate({ path: { id: data.id } })}>
							<Square className="h-4 w-4 mr-2" />
							<span>Cancel doctor</span>
						</Button>
					) : (
						<Button onClick={() => startDoctor.mutate({ path: { id: data.id } })} disabled={startDoctor.isPending}>
							<Stethoscope className="h-4 w-4 mr-2" />
							Run doctor
						</Button>
					)}
					<Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} disabled={deleteRepo.isPending}>
						<Trash2 className="h-4 w-4 mr-2" />
						Delete
					</Button>
				</div>
			</div>

			<Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })}>
				<TabsList className="mb-2">
					<TabsTrigger value="info">Configuration</TabsTrigger>
					<TabsTrigger value="snapshots">Snapshots</TabsTrigger>
				</TabsList>
				<TabsContent value="info">
					<RepositoryInfoTabContent repository={data} />
				</TabsContent>
				<TabsContent value="snapshots">
					<RepositorySnapshotsTabContent repository={data} />
				</TabsContent>
			</Tabs>

			<AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete repository?</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete the repository <strong>{data.name}</strong>? This will not remove the
							actual data from the backend storage, only the repository configuration will be deleted.
							<br />
							<br />
							All backup schedules associated with this repository will also be removed.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleConfirmDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							<Trash2 className="h-4 w-4 mr-2" />
							Delete repository
						</AlertDialogAction>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
