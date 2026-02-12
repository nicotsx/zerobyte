import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Database } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getRepositoryOptions, updateRepositoryMutation } from "~/client/api-client/@tanstack/react-query.gen";
import {
	CreateRepositoryForm,
	type RepositoryFormValues,
} from "~/client/modules/repositories/components/create-repository-form";
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
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import type { RepositoryConfig } from "~/schemas/restic";
import { useNavigate } from "@tanstack/react-router";

const riskyLocationFieldsByBackend = {
	local: ["path"],
	s3: ["endpoint", "bucket"],
	r2: ["endpoint", "bucket"],
	gcs: ["bucket", "projectId"],
	azure: ["container", "accountName", "endpointSuffix"],
	rest: ["url", "path"],
	sftp: ["host", "port", "path", "user"],
	rclone: ["remote", "path"],
} as const;

const hasRiskyLocationChange = (initialConfig: RepositoryConfig, nextConfig: RepositoryFormValues): boolean => {
	const fields = riskyLocationFieldsByBackend[initialConfig.backend] ?? [];

	return fields.some(
		(field) => initialConfig[field as keyof RepositoryConfig] !== nextConfig[field as keyof RepositoryFormValues],
	);
};

export function EditRepositoryPage({ repositoryId }: { repositoryId: string }) {
	const navigate = useNavigate();
	const [showRiskConfirm, setShowRiskConfirm] = useState(false);
	const [pendingValues, setPendingValues] = useState<RepositoryFormValues | null>(null);

	const { data: repository } = useSuspenseQuery({
		...getRepositoryOptions({ path: { id: repositoryId } }),
	});

	const updateRepository = useMutation({
		...updateRepositoryMutation(),
		onSuccess: async (data) => {
			toast.success("Repository updated successfully");
			setShowRiskConfirm(false);
			setPendingValues(null);
			void navigate({ to: `/repositories/${data.shortId}` });
		},
		onError: (error) => {
			toast.error("Failed to update repository", {
				description: parseError(error)?.message,
			});
		},
	});

	const initialConfig = repository.config as RepositoryConfig;
	const initialValues: RepositoryFormValues = {
		...initialConfig,
		name: repository.name,
		compressionMode: repository.compressionMode ?? "auto",
	};

	const submitUpdate = (values: RepositoryFormValues) => {
		updateRepository.mutate({
			path: { id: repositoryId },
			body: {
				name: values.name,
				compressionMode: values.compressionMode,
				config: values,
			},
		});
	};

	const handleSubmit = (values: RepositoryFormValues) => {
		const nextConfig = values;

		if (hasRiskyLocationChange(initialConfig, nextConfig)) {
			setPendingValues(values);
			setShowRiskConfirm(true);
			return;
		}

		submitUpdate(values);
	};

	const handleSaveAnyway = () => {
		if (!pendingValues) {
			return;
		}

		submitUpdate(pendingValues);
	};

	const handleRiskConfirmOpenChange = (open: boolean) => {
		setShowRiskConfirm(open);
		if (!open) {
			setPendingValues(null);
		}
	};

	return (
		<>
			<div className="container mx-auto space-y-6">
				<Card>
					<CardHeader>
						<div className="flex items-center gap-3">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
								<Database className="w-5 h-5 text-primary" />
							</div>
							<CardTitle>Edit Repository</CardTitle>
						</div>
					</CardHeader>
					<CardContent className="space-y-6">
						{updateRepository.isError && (
							<Alert variant="destructive">
								<AlertDescription>
									<strong>Failed to update repository:</strong>
									<br />
									{parseError(updateRepository.error)?.message}
								</AlertDescription>
							</Alert>
						)}

						<CreateRepositoryForm
							mode="update"
							initialValues={initialValues}
							onSubmit={handleSubmit}
							loading={updateRepository.isPending}
						/>
						<div className="flex justify-end pt-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => navigate({ to: `/repositories/${repository.shortId}` })}
							>
								Cancel
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			<AlertDialog open={showRiskConfirm} onOpenChange={handleRiskConfirmOpenChange}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Repository location changed</AlertDialogTitle>
						<AlertDialogDescription>
							Changing endpoint, bucket, host, or path fields may point to a different repository location. Before
							saving, ensure the repository already exists at the new target.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleSaveAnyway} disabled={updateRepository.isPending}>
							Save anyway
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
