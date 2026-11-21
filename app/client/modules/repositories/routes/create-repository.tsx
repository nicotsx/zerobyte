import { useMutation } from "@tanstack/react-query";
import { Database, Laptop, Plus, Server } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { createRepositoryMutation } from "~/client/api-client/@tanstack/react-query.gen";
import {
	CreateRepositoryForm,
	formSchema,
	type RepositoryFormValues,
} from "~/client/modules/repositories/components/create-repository-form";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";
import { usePermissions } from "~/client/hooks/use-permissions";
import { cn } from "~/client/lib/utils";

const storageHostOptions = [
	{ value: "server", label: "This server", icon: Server },
	{ value: "machine", label: "Another machine", icon: Laptop },
] as const;

// Only local repositories can be stored on another machine.
const machineRepositoryDefaults = {
	backend: "local",
	compressionMode: "auto",
	path: "",
	autoCheckEnabled: true,
} as const;

export function CreateRepositoryPage() {
	const navigate = useNavigate();
	const formId = useId();
	const permissions = usePermissions();
	const [storedOn, setStoredOn] = useState<"server" | "machine">("server");

	const createRepository = useMutation({
		...createRepositoryMutation(),
		onSuccess: (data) => {
			toast.success("Repository created successfully");
			void navigate({ to: `/repositories/${data.repository.shortId}` });
		},
	});

	const handleSubmit = (values: RepositoryFormValues) => {
		const { name, compressionMode, autoCheckEnabled, agentId, ...config } = formSchema.parse(values);

		createRepository.mutate({
			body: {
				config,
				name,
				compressionMode,
				autoCheckEnabled,
				agentId,
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
					{permissions.hasRuntimeFeature("remoteAgents") && (
						<fieldset className="space-y-2">
							<legend className="text-sm font-medium">Repository is stored on</legend>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{storageHostOptions.map((option) => (
									<label
										key={option.value}
										className={cn(
											"flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
											storedOn === option.value && "border-primary bg-primary/5",
										)}
									>
										<input
											type="radio"
											name="repository-host"
											value={option.value}
											checked={storedOn === option.value}
											onChange={() => setStoredOn(option.value)}
											className="size-4 accent-primary"
										/>
										<option.icon className="size-4 text-muted-foreground" aria-hidden="true" />
										{option.label}
									</label>
								))}
							</div>
						</fieldset>
					)}
					<CreateRepositoryForm
						key={storedOn}
						mode="create"
						storedOn={storedOn}
						initialValues={storedOn === "machine" ? machineRepositoryDefaults : undefined}
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
