import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useId } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
	postApiV1SecretProvidersMutation,
	postApiV1SecretProvidersTestConfigMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { CreateSecretProviderForm, type SecretProviderFormValues } from "../components/create-secret-provider-form";
import { SECRET_PROVIDER_METADATA, type SecretProviderType } from "~/schemas/secrets";

export const handle = {
	breadcrumb: () => [
		{ label: "Settings", href: "/settings" },
		{ label: "Secret Providers", href: "/settings/secret-providers" },
		{ label: "Create" },
	],
};

export function meta() {
	return [
		{ title: "Zerobyte - Add Secret Provider" },
		{
			name: "description",
			content: "Connect a new secret provider.",
		},
	];
}

export default function CreateSecretProvider() {
	const navigate = useNavigate();
	const formId = useId();
	const queryClient = useQueryClient();

	const createProvider = useMutation({
		...postApiV1SecretProvidersMutation(),
		onSuccess: () => {
			toast.success("Secret provider created successfully");
			queryClient.invalidateQueries({ queryKey: ["getApiV1SecretProviders"] });
			navigate("/settings/secret-providers");
		},
	});

	const testConfig = useMutation({
		...postApiV1SecretProvidersTestConfigMutation(),
		onSuccess: (data) => {
			const result = data as { healthy: boolean; error?: string };
			if (result.healthy) {
				toast.success("Connection test successful");
			} else {
				toast.error("Connection test failed", { description: result.error });
			}
		},
		onError: (error) => {
			toast.error("Connection test failed", { description: parseError(error)?.message });
		},
	});

	const handleTestConnection = (values: SecretProviderFormValues) => {
		const providerMeta = SECRET_PROVIDER_METADATA[values.type as SecretProviderType];
		if (!providerMeta) return;
		testConfig.mutate({
			body: {
				config: providerMeta.buildConfig(values),
			},
		});
	};

	const handleSubmit = (values: SecretProviderFormValues) => {
		const providerMeta = SECRET_PROVIDER_METADATA[values.type as SecretProviderType];
		if (!providerMeta) return;
		createProvider.mutate({
			body: {
				name: values.name,
				config: providerMeta.buildConfig(values),
				customPrefix: values.customPrefix || undefined,
			},
		});
	};

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<KeyRound className="w-5 h-5 text-primary" />
						</div>
						<div>
							<CardTitle>Add Secret Provider</CardTitle>
							<p className="text-sm text-muted-foreground mt-1">
								Connect an external secret provider to securely manage credentials
							</p>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					{createProvider.isError && (
						<Alert variant="destructive">
							<AlertDescription>
								<strong>Failed to create secret provider:</strong>
								<br />
								{parseError(createProvider.error)?.message}
							</AlertDescription>
						</Alert>
					)}
					<CreateSecretProviderForm
						mode="create"
						formId={formId}
						onSubmit={handleSubmit}
						onTestConnection={handleTestConnection}
						isTestingConnection={testConfig.isPending}
					/>
					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button type="button" variant="secondary" onClick={() => navigate("/settings/secret-providers")}>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={createProvider.isPending}>
							Add Provider
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
