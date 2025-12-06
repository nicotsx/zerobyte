import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { FolderSearch, KeyRound, RotateCcw, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import {
	deleteApiV1SecretProvidersIdMutation,
	getApiV1SecretProvidersIdOptions,
	patchApiV1SecretProvidersIdMutation,
	postApiV1SecretProvidersIdTestMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { getApiV1SecretProvidersId } from "~/client/api-client";
import { StatusDot } from "~/client/components/status-dot";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/client/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { SingleProviderBrowserDialog } from "~/client/components/ui/secret-browser-dialog";
import { parseError } from "~/client/lib/errors";
import { CreateSecretProviderForm, type SecretProviderFormValues } from "../components/create-secret-provider-form";
import { SECRET_PROVIDER_METADATA, type SecretProviderType } from "~/schemas/secrets";

// Type for provider details response
interface SecretProviderDetails {
	id: number;
	name: string;
	type: SecretProviderType;
	enabled: boolean;
	uriPrefix: string;
	customPrefix: string | null;
	healthStatus: "healthy" | "unhealthy" | "unknown";
	lastHealthCheck: number | null;
	lastError: string | null;
	createdAt: number;
	updatedAt: number;
	configSummary?: Record<string, unknown>;
}

export const handle = {
	breadcrumb: (data: SecretProviderDetails | null) => [
		{ label: "Settings", href: "/settings" },
		{ label: "Secret Providers", href: "/settings/secret-providers" },
		{ label: data?.name || "Details" },
	],
};

export function meta({ data }: { data?: SecretProviderDetails }) {
	return [
		{ title: `Zerobyte - ${data?.name || "Secret Provider"}` },
		{
			name: "description",
			content: "Manage secret provider settings.",
		},
	];
}

interface ClientLoaderArgs {
	params: { id: string };
}

export const clientLoader = async ({ params }: ClientLoaderArgs): Promise<SecretProviderDetails> => {
	const result = await getApiV1SecretProvidersId({ path: { id: params.id } });
	const data = result.data as { provider: SecretProviderDetails } | undefined;
	if (data?.provider) return data.provider;
	throw new Error("Provider not found");
};



interface SecretProviderDetailsProps {
	loaderData: SecretProviderDetails;
}

export default function SecretProviderDetails({ loaderData }: SecretProviderDetailsProps) {
	const { id } = useParams();
	const navigate = useNavigate();
	const formId = useId();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [browseDialogOpen, setBrowseDialogOpen] = useState(false);
	const [isFormDirty, setIsFormDirty] = useState(false);

	const { data: providerResponse } = useQuery({
		...getApiV1SecretProvidersIdOptions({ path: { id: id! } }),
		initialData: { provider: loaderData },
		select: (data) => (data as { provider: SecretProviderDetails }).provider,
	});
	const provider = providerResponse as SecretProviderDetails;

	const updateProvider = useMutation({
		...patchApiV1SecretProvidersIdMutation(),
		onSuccess: () => {
			toast.success("Provider updated successfully");
			queryClient.invalidateQueries({ queryKey: ["getApiV1SecretProviders"] });
			queryClient.invalidateQueries({ queryKey: ["getApiV1SecretProvidersId", { path: { id: id! } }] });
		},
	});

	const deleteProvider = useMutation({
		...deleteApiV1SecretProvidersIdMutation(),
		onSuccess: () => {
			toast.success("Provider deleted successfully");
			queryClient.invalidateQueries({ queryKey: ["getApiV1SecretProviders"] });
			navigate("/settings/secret-providers");
		},
	});

	const testProvider = useMutation({
		...postApiV1SecretProvidersIdTestMutation(),
		onSuccess: (data: unknown) => {
			const result = data as { healthy: boolean; error?: string };
			if (result.healthy) {
				toast.success("Connection test successful");
			} else {
				toast.error("Connection test failed", { description: result.error });
			}
			queryClient.invalidateQueries({ queryKey: ["getApiV1SecretProvidersId", { path: { id: id! } }] });
		},
		onError: (error) => {
			toast.error("Connection test failed", { description: parseError(error)?.message });
		},
	});

	const handleSubmit = (values: SecretProviderFormValues) => {
		const providerMeta = SECRET_PROVIDER_METADATA[values.type as SecretProviderType];
		if (!providerMeta) return;
		const config = providerMeta.buildConfig(values);

		// Determine the default prefix for this provider type
		// If user entered the default prefix or cleared the field, send empty string (server will use default)
		// Otherwise use the custom prefix they entered
		const prefixValue = values.customPrefix?.trim() || "";
		const customPrefix = prefixValue === providerMeta.defaultPrefix || prefixValue === "" ? "" : prefixValue;

		updateProvider.mutate({
			path: { id: id! },
			body: {
				name: values.name,
				enabled: values.enabled,
				config,
				customPrefix,
			},
		});
	};

	const handleDelete = () => {
		deleteProvider.mutate({ path: { id: id! } });
	};

	// Build default form values dynamically from configSummary
	const buildDefaultFormValues = (): Partial<SecretProviderFormValues> => {
		const values: Partial<SecretProviderFormValues> = {
			name: provider.name,
			type: provider.type,
			enabled: provider.enabled,
			// Show the actual prefix being used (strip the :// suffix)
			customPrefix: provider.uriPrefix.replace("://", ""),
		};

		// Add default values for all provider field configs
		for (const providerMeta of Object.values(SECRET_PROVIDER_METADATA)) {
			for (const field of providerMeta.fields) {
				if (field.type === "secret") {
					// Secret fields are always empty (server never returns them)
					values[field.name] = "";
				} else if (field.type === "switch") {
					// Use config summary value or default to true
					values[field.name] = (provider.configSummary?.[field.name] as boolean) ?? true;
				} else {
					// Use config summary value or empty string
					values[field.name] = (provider.configSummary?.[field.name] as string) ?? "";
				}
			}
		}

		return values;
	};
	const defaultFormValues = buildDefaultFormValues();

	return (
		<div className="container mx-auto space-y-6">
			{/* Status Card */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
								<KeyRound className="w-5 h-5 text-primary" />
							</div>
							<div>
								<CardTitle className="flex items-center gap-2">
									{provider.name}
									<StatusDot
										variant={
											provider.healthStatus === "healthy"
												? "success"
												: provider.healthStatus === "unhealthy"
													? "error"
													: "neutral"
										}
										label={provider.healthStatus}
									/>
								</CardTitle>
								<CardDescription>{SECRET_PROVIDER_METADATA[provider.type as SecretProviderType]?.label || provider.type}</CardDescription>
							</div>
						</div>
						<div className="flex gap-2">
							<Button
								variant="outline"
								onClick={() => setBrowseDialogOpen(true)}
								disabled={!provider.enabled || provider.healthStatus !== "healthy"}
								title={
									!provider.enabled
										? "Enable provider to browse secrets"
										: provider.healthStatus !== "healthy"
											? "Provider must be healthy to browse secrets"
											: "Browse available secrets"
								}
							>
								<FolderSearch className="w-4 h-4 mr-2" />
								Browse Secrets
							</Button>
							<Button
								variant="outline"
								onClick={() => testProvider.mutate({ path: { id: id! } })}
								loading={testProvider.isPending}
								disabled={isFormDirty}
								title={isFormDirty ? "Save changes before testing" : "Test connection"}
							>
								<RotateCcw className="w-4 h-4 mr-2" />
								Test Connection
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
						<div>
							<p className="text-muted-foreground">Status</p>
							<p className="font-medium">{provider.enabled ? "Enabled" : "Disabled"}</p>
						</div>
						<div>
							<p className="text-muted-foreground">URI Prefix</p>
							<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{provider.uriPrefix}</code>
							{provider.customPrefix && <p className="text-xs text-muted-foreground mt-1">(custom)</p>}
						</div>
						<div>
							<p className="text-muted-foreground">Health Status</p>
							<p className="font-medium capitalize">{provider.healthStatus}</p>
						</div>
						<div>
							<p className="text-muted-foreground">Last Health Check</p>
							<p className="font-medium">
								{provider.lastHealthCheck
									? formatDistanceToNow(new Date(provider.lastHealthCheck), { addSuffix: true })
									: "Never"}
							</p>
						</div>
					</div>
					{provider.lastError && (
						<Alert variant="destructive" className="mt-4">
							<AlertDescription>
								<strong>Last Error:</strong> {provider.lastError}
							</AlertDescription>
						</Alert>
					)}
				</CardContent>
			</Card>

			{/* Edit Form Card */}
			<Card>
				<CardHeader>
					<CardTitle>Provider Settings</CardTitle>
					<CardDescription>
						Update the configuration for this secret provider. Sensitive fields must be re-entered for security.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					{updateProvider.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to update provider:</strong>
								<br />
								{parseError(updateProvider.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateSecretProviderForm
						key={`${provider.id}-${provider.updatedAt}`}
						mode="edit"
						formId={formId}
						onSubmit={handleSubmit}
						onDirtyChange={setIsFormDirty}
						defaultValues={defaultFormValues}
					/>
					<div className="flex justify-between pt-4 border-t">
						<Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
							<DialogTrigger asChild>
								<Button variant="destructive" type="button">
									<Trash2 className="w-4 h-4 mr-2" />
									Delete Provider
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Delete Secret Provider</DialogTitle>
									<DialogDescription>
										Are you sure you want to delete "{provider.name}"? This action cannot be undone. Any secrets
										currently using this provider will no longer be resolvable.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter>
									<Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
										Cancel
									</Button>
									<Button variant="destructive" onClick={handleDelete} loading={deleteProvider.isPending}>
										Delete Provider
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={() => navigate("/settings/secret-providers")}>
								Cancel
							</Button>
							<Button type="submit" form={formId} loading={updateProvider.isPending} disabled={!isFormDirty}>
								Save Changes
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Browse Secrets Dialog */}
			<SingleProviderBrowserDialog
				open={browseDialogOpen}
				onOpenChange={setBrowseDialogOpen}
				providerId={String(provider.id)}
				providerName={provider.name}
				providerScheme={provider.uriPrefix.replace("://", "")}
			/>
		</div>
	);
}
