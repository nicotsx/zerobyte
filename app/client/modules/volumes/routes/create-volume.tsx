import { useMutation } from "@tanstack/react-query";
import { HardDrive, Laptop, Plus, Server } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { createVolumeMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { CreateVolumeForm, formSchema, type FormValues } from "~/client/modules/volumes/components/create-volume-form";
import {
	AgentFilesystemSourceForm,
	type FilesystemSourceValues,
} from "~/client/modules/volumes/components/agent-filesystem-source-form";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";
import { usePermissions } from "~/client/hooks/use-permissions";
import { cn } from "~/client/lib/utils";

const sourceHostOptions = [
	{ value: "local", label: "This server", icon: Server },
	{ value: "remote", label: "Another machine", icon: Laptop },
] as const;

export function CreateVolumePage() {
	const navigate = useNavigate();
	const formId = useId();
	const permissions = usePermissions();

	const [sourceHost, setSourceHost] = useState<"local" | "remote">("local");

	const createVolume = useMutation({
		...createVolumeMutation(),
		onSuccess: (data) => {
			toast.success("Source created successfully");
			void navigate({ to: `/volumes/${data.shortId}` });
		},
	});

	const handleSubmit = (values: FormValues) => {
		const { name, ...config } = formSchema.parse(values);

		createVolume.mutate({
			body: {
				sourceKind: "managed",
				config,
				name,
			},
		});
	};

	const handleRemoteSubmit = (values: FilesystemSourceValues) => {
		createVolume.mutate({ body: { sourceKind: "filesystem", ...values } });
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<HardDrive className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Create Source</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{createVolume.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create source:</strong>
								<br />
								{parseError(createVolume.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					{permissions.hasRuntimeFeature("remoteAgents") && (
						<fieldset className="space-y-2">
							<legend className="text-sm font-medium">Files are on</legend>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{sourceHostOptions.map((option) => (
									<label
										key={option.value}
										className={cn(
											"flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
											sourceHost === option.value && "border-primary bg-primary/5",
										)}
									>
										<input
											type="radio"
											name="source-host"
											value={option.value}
											checked={sourceHost === option.value}
											onChange={() => setSourceHost(option.value)}
											className="size-4 accent-primary"
										/>
										<option.icon className="size-4 text-muted-foreground" aria-hidden="true" />
										{option.label}
									</label>
								))}
							</div>
						</fieldset>
					)}
					{sourceHost === "local" && (
						<CreateVolumeForm
							mode="create"
							formId={formId}
							onSubmit={handleSubmit}
							loading={createVolume.isPending}
						/>
					)}
					{sourceHost !== "local" && (
						<AgentFilesystemSourceForm formId={formId} onSubmit={handleRemoteSubmit} />
					)}
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate({ to: "/volumes" })}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={createVolume.isPending}>
							<Plus className="h-4 w-4 mr-2" />
							Create Source
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
