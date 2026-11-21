import { useMutation, useQuery } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
	getSsoAccountLinkProvidersOptions,
	startSsoAccountLinkMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { parseError } from "~/client/lib/errors";

export function SsoAccountLinkSection() {
	const { ssoLink } = useSearch({ from: "/(dashboard)/settings/" });
	const { data: providers, isError } = useQuery(getSsoAccountLinkProvidersOptions());

	const startLink = useMutation({
		...startSsoAccountLinkMutation(),
		onSuccess: ({ url }) => {
			window.location.assign(url);
		},
		onError: (error) => {
			toast.error("Could not start SSO linking", { description: parseError(error)?.message });
		},
	});

	if (!providers?.length && !isError && ssoLink !== "failed") return null;

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Link2 className="size-5" />
					Single Sign-On
				</CardTitle>
				<CardDescription className="mt-1.5">
					Link a provider you trust to sign in to your Zerobyte account.
				</CardDescription>
			</div>
			<CardContent className="space-y-3 p-6">
				{ssoLink === "failed" && (
					<Alert variant="destructive">
						<AlertDescription>
							SSO linking failed. Use the same email address at both providers and try again.
						</AlertDescription>
					</Alert>
				)}
				{isError && <p role="alert">Could not load SSO providers.</p>}
				{providers?.map((provider) => (
					<div
						key={provider.providerId}
						className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
					>
						<div className="min-w-0">
							<div className="font-medium">{provider.providerId}</div>
							<div className="break-all text-sm text-muted-foreground">{provider.issuer}</div>
						</div>
						{provider.linked ? (
							<span className="text-sm text-muted-foreground">Linked</span>
						) : (
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={startLink.isPending}
								loading={
									startLink.isPending && startLink.variables?.body.providerId === provider.providerId
								}
								onClick={() => startLink.mutate({ body: { providerId: provider.providerId } })}
							>
								Link SSO
							</Button>
						)}
					</div>
				))}
			</CardContent>
		</>
	);
}
