import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { redirect, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import {
	deleteRepositoryMutation,
	doctorRepositoryMutation,
	getRepositoryOptions,
	listSnapshotsOptions,
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
import { Loader2, Stethoscope, Trash2, X } from "lucide-react";

export const handle = {
	breadcrumb: (match: Route.MetaArgs) => [
		{ label: "Repositories", href: "/repositories" },
		{ label: match.params.name },
	],
};

export function meta({ params }: Route.MetaArgs) {
	return [
		{ title: `Zerobyte - ${params.name}` },
		{
			name: "description",
			content: "View repository configuration, status, and snapshots.",
		},
	];
}

export const clientLoader = async ({ params }: Route.ClientLoaderArgs) => {
	const repository = await getRepository({ path: { name: params.name ?? "" } });
	if (repository.data) return repository.data;

	return redirect("/repositories");
};

export default function RepositoryDetailsPage({ loaderData }: Route.ComponentProps) {
	const [showDoctorResults, setShowDoctorResults] = useState(false);

	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const [searchParams, setSearchParams] = useSearchParams();
	const activeTab = searchParams.get("tab") || "info";

	const { data } = useQuery({
		...getRepositoryOptions({ path: { name: loaderData.name } }),
		initialData: loaderData,
	});

	useEffect(() => {
		queryClient.prefetchQuery(listSnapshotsOptions({ path: { name: data.name } }));
	}, [queryClient, data.name]);

	const deleteRepo = useMutation({
		...deleteRepositoryMutation(),
		onSuccess: () => {
			toast.success("Repository deleted successfully");
			navigate("/repositories");
		},
		onError: (error) => {
			toast.error("Failed to delete repository", {
				description: parseError(error)?.message,
			});
		},
	});

	const doctorMutation = useMutation({
		...doctorRepositoryMutation(),
		onSuccess: (data) => {
			if (data) {
				setShowDoctorResults(true);

				if (data.success) {
					toast.success("Repository doctor completed successfully");
				} else {
					toast.warning("Doctor completed with some issues", {
						description: "Check the details for more information",
						richColors: true,
					});
				}
			}
		},
		onError: (error) => {
			toast.error("Failed to run doctor", {
				description: parseError(error)?.message,
			});
		},
	});

	const handleConfirmDelete = () => {
		setShowDeleteConfirm(false);
		deleteRepo.mutate({ path: { name: data.name } });
	};

	const getStepLabel = (step: string) => {
		switch (step) {
			case "unlock":
				return "Unlock Repository";
			case "check":
				return "Check Repository";
			case "repair_index":
				return "Repair Index";
			case "recheck":
				return "Re-check Repository";
			default:
				return step;
		}
	};

	return (
		<>
			<div className="flex items-center justify-between mb-4">
				<div className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
					<span
						className={cn("inline-flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-gray-500/10 text-gray-500", {
							"bg-green-500/10 text-green-500": data.status === "healthy",
							"bg-red-500/10 text-red-500": data.status === "error",
						})}
					>
						{data.status || "unknown"}
					</span>
					<span className="text-xs bg-primary/10 rounded-md px-2 py-1">{data.type}</span>
				</div>
				<div className="flex gap-4">
					<Button
						onClick={() => doctorMutation.mutate({ path: { name: data.name } })}
						disabled={doctorMutation.isPending}
						variant={"outline"}
					>
						{doctorMutation.isPending ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Running doctor...
							</>
						) : (
							<>
								<Stethoscope className="h-4 w-4 mr-2" />
								Run doctor
							</>
						)}
					</Button>
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
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="flex gap-3 justify-end">
						<AlertDialogCancel>
							<X className="h-4 w-4 mr-2" />
							Cancel
						</AlertDialogCancel>
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

			<AlertDialog open={showDoctorResults} onOpenChange={setShowDoctorResults}>
				<AlertDialogContent className="max-w-2xl">
					<AlertDialogHeader>
						<AlertDialogTitle>Doctor results</AlertDialogTitle>
						<AlertDialogDescription>Repository doctor operation completed</AlertDialogDescription>
					</AlertDialogHeader>

					{doctorMutation.data && (
						<div className="space-y-3 max-h-96 overflow-y-auto">
							{doctorMutation.data.steps.map((step) => (
								<div
									key={step.step}
									className={cn("border rounded-md p-3", {
										"bg-green-500/10 border-green-500/20": step.success,
										"bg-yellow-500/10 border-yellow-500/20": !step.success,
									})}
								>
									<div className="flex items-center justify-between mb-2">
										<span className="font-medium text-sm">{getStepLabel(step.step)}</span>
										<span
											className={cn("text-xs px-2 py-1 rounded", {
												"bg-green-500/20 text-green-500": step.success,
												"bg-yellow-500/20 text-yellow-500": !step.success,
											})}
										>
											{step.success ? "Success" : "Warning"}
										</span>
									</div>
									{step.error && <p className="text-xs text-red-500 mt-1">{step.error}</p>}
								</div>
							))}
						</div>
					)}

					<div className="flex justify-end">
						<Button onClick={() => setShowDoctorResults(false)}>Close</Button>
					</div>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
