import { useMutation } from "@tanstack/react-query";
import { Database, Plus } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";
import { createRepositoryMutation } from "~/client/api-client/@tanstack/react-query.gen";
import {
	CreateRepositoryForm,
	type RepositoryFormValues,
} from "~/client/modules/repositories/components/create-repository-form";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";

export const handle = {
	breadcrumb: () => [{ label: "Repositories", href: "/repositories" }, { label: "Create" }],
};

export function CreateRepositoryPage() {
	const navigate = useNavigate();
	const formId = useId();

	const createRepository = useMutation({
		...createRepositoryMutation(),
		onSuccess: (data) => {
			toast.success("Repository created successfully");
			void navigate({ to: `/repositories/${data.repository.shortId}` });
		},
	});

	const handleSubmit = (values: RepositoryFormValues) => {
		createRepository.mutate({
			body: {
				config: values,
				name: values.name,
				compressionMode: values.compressionMode,
			},
		});
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<Database className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Create Repository</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{createRepository.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create repository:</strong>
								<br />
								{parseError(createRepository.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateRepositoryForm
						mode="create"
						formId={formId}
						onSubmit={handleSubmit}
						loading={createRepository.isPending}
					/>
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate({ to: "/repositories" })}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={createRepository.isPending}>
							<Plus className="h-4 w-4 mr-2" />
							Create repository
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
