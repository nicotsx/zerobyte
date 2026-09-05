import { useMutation } from "@tanstack/react-query";
import { HardDrive, Laptop, Plus, Server } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { createVolumeMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { CreateVolumeForm, formSchema, type FormValues } from "~/client/modules/volumes/components/create-volume-form";
import {
	AgentFilesystemSourceForm,
	type AgentFilesystemFormValues,
} from "~/client/modules/volumes/components/agent-filesystem-source-form";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { useNavigate } from "@tanstack/react-router";
import { usePermissions } from "~/client/hooks/use-permissions";
import { cn } from "~/client/lib/utils";
import { useSourceDiscovery } from "./source-discovery";

export function CreateVolumePage() {
	const navigate = useNavigate();
	const formId = useId();
	const permissions = usePermissions();

	const supportsRemoteSources = permissions.hasRuntimeFeature("remoteAgents");

	const [sourceHost, setSourceHost] = useState<"local" | "remote">("local");

	const { isReady: remoteDiscoveryIsReady, sourceDiscovery } = useSourceDiscovery(supportsRemoteSources);

	const sourceMachines = sourceDiscovery.status === "ready" ? sourceDiscovery.machines : [];
	const hasRemoteMachines = sourceMachines.length > 0;

	const activeSourceHost = supportsRemoteSources ? sourceHost : "local";
	const preserveActiveRemoteChoice = activeSourceHost === "remote";
	const showSourceHostControl = hasRemoteMachines || preserveActiveRemoteChoice;

	const remoteDiscoveryFailed = sourceDiscovery.status === "error";
	const retryRemoteDiscoveryAction = remoteDiscoveryFailed ? sourceDiscovery.retry : undefined;

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
				config,
				name,
			},
		});
	};

	const handleRemoteSubmit = (values: AgentFilesystemFormValues) => {
		if (!remoteDiscoveryIsReady) {
			return;
		}
		createVolume.mutate({ body: values });
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
					{remoteDiscoveryFailed && activeSourceHost !== "remote" && (
						<Alert variant="destructive">
							<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
								<span>Available machines could not be loaded. Remote locations are unavailable.</span>
								<Button type="button" variant="ghost" size="sm" onClick={retryRemoteDiscoveryAction}>
									Retry
								</Button>
							</AlertDescription>
						</Alert>
					)}
					{createVolume.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create source:</strong>
								<br />
								{parseError(createVolume.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					{showSourceHostControl && (
						<fieldset className="space-y-2">
							<legend className="text-sm font-medium">Files are on</legend>
							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
								{[
									{ value: "local" as const, label: "This server", icon: Server },
									{ value: "remote" as const, label: "Another machine", icon: Laptop },
								].map((option) => {
									const Icon = option.icon;
									const selected = activeSourceHost === option.value;
									return (
										<label
											className={cn(
												"flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
												selected && "border-primary bg-primary/5",
											)}
											key={option.value}
										>
											<input
												type="radio"
												name="source-host"
												value={option.value}
												checked={selected}
												onChange={() => setSourceHost(option.value)}
												className="size-4 accent-primary"
											/>
											<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
											{option.label}
										</label>
									);
								})}
							</div>
						</fieldset>
					)}
					{activeSourceHost === "local" && (
						<CreateVolumeForm
							mode="create"
							formId={formId}
							onSubmit={handleSubmit}
							loading={createVolume.isPending}
						/>
					)}
					{activeSourceHost === "remote" && (
						<AgentFilesystemSourceForm
							formId={formId}
							discovery={sourceDiscovery}
							onSubmit={handleRemoteSubmit}
							loading={createVolume.isPending}
						/>
					)}
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate({ to: "/volumes" })}>
							Cancel
						</Button>
						<Button
							type="submit"
							form={formId}
							loading={createVolume.isPending}
							disabled={activeSourceHost === "remote" && !remoteDiscoveryIsReady}
						>
							<Plus className="h-4 w-4 mr-2" />
							Create Source
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
