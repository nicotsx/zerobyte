import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { pickBy } from "es-toolkit";
import { Pencil, RefreshCw, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
	checkSsoProviderDiscoveryOptions,
	getSsoProviderDetailsOptions,
	updateSsoProviderMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertAction, AlertContent, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import type { SsoProviderDetails, SsoDiscoveryResult } from "~/lib/sso-configuration";
import { parseError } from "~/client/lib/errors";
import { getLinkedSsoProviderEditError, isSameIssuerExceptTrailingSlash } from "~/lib/sso-provider-identity";

function getUsableDiscoveredIssuer(provider: SsoProviderDetails, discovery?: SsoDiscoveryResult) {
	const discoveredIssuer = discovery?.discoveryIssuer;
	if (!discoveredIssuer) return null;
	if (!provider.hasLinkedAccounts) return discoveredIssuer;
	if (!isSameIssuerExceptTrailingSlash(provider.issuer, discoveredIssuer)) return null;

	return discoveredIssuer;
}

export function EditSsoProviderDialog({ providerId }: { providerId: string }) {
	const [open, setOpen] = useState(false);
	const provider = useQuery({ ...getSsoProviderDetailsOptions({ path: { providerId } }), enabled: open });

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon" title={`Edit ${providerId}`} aria-label={`Edit ${providerId}`}>
					<Pencil className="h-4 w-4" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>Edit SSO provider</DialogTitle>
					<DialogDescription>
						Update {providerId} without recreating it or removing linked accounts.
					</DialogDescription>
				</DialogHeader>
				{provider.isPending && <output className="text-sm text-muted-foreground">Loading settings…</output>}
				{provider.isError && (
					<Alert variant="destructive">
						<AlertContent>
							<AlertDescription>
								{parseError(provider.error)?.message ?? "Could not load this provider."}
							</AlertDescription>
						</AlertContent>
						<AlertAction>
							<Button type="button" variant="outline" onClick={() => void provider.refetch()}>
								Try again
							</Button>
						</AlertAction>
					</Alert>
				)}
				{open && provider.data && <SsoProviderEditor provider={provider.data} onClose={() => setOpen(false)} />}
			</DialogContent>
		</Dialog>
	);
}

export function SsoProviderEditor({ provider, onClose }: { provider: SsoProviderDetails; onClose: () => void }) {
	const {
		register,
		handleSubmit,
		control,
		setValue,
		formState: { dirtyFields, isDirty },
	} = useForm({
		defaultValues: {
			issuer: provider.issuer,
			domain: provider.domain,
			discoveryEndpoint: provider.discoveryEndpoint,
			clientId: provider.clientId,
			clientSecret: "",
		},
	});

	const issuer = useWatch({ control, name: "issuer" });

	const discovery = useQuery({
		...checkSsoProviderDiscoveryOptions({ path: { providerId: provider.providerId } }),
		enabled: false,
		retry: false,
	});

	const update = useMutation({
		...updateSsoProviderMutation(),
		onSuccess: () => {
			toast.success("SSO provider updated");
			onClose();
		},
	});

	let identityChangeError: string | null = null;
	if (provider.hasLinkedAccounts) {
		identityChangeError = getLinkedSsoProviderEditError(provider, { issuer });
	}

	const discoveredIssuer = getUsableDiscoveredIssuer(provider, discovery.data);

	const copyCallbackUrl = async () => {
		try {
			await navigator.clipboard.writeText(provider.callbackUrl);
			toast.success("Callback URL copied");
		} catch {
			toast.error("Could not copy. Select the URL and copy it manually.");
		}
	};

	const save = handleSubmit((values) => {
		const body = pickBy(values, (value, key) => !!dirtyFields[key] && value !== "");
		if (Object.keys(body).length === 0) return;

		update.mutate({ path: { providerId: provider.providerId }, body });
	});

	return (
		<form onSubmit={save} className="min-h-0 flex flex-col gap-5">
			<div className="min-h-0 space-y-5 overflow-y-auto pr-1">
				{provider.proxyMisconfigured && (
					<Alert variant="warning">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>SSO is generating an HTTP callback</AlertTitle>
						<AlertDescription>
							Enable <code>TRUST_PROXY=true</code> and make sure your reverse proxy forwards{" "}
							<code>X-Forwarded-Proto: https</code>. Restart Zerobyte after changing its environment. The
							expected callback is{" "}
							<span className="break-all font-mono">{provider.expectedCallbackUrl}</span>.
						</AlertDescription>
					</Alert>
				)}
				<div className="space-y-2">
					<Label htmlFor="sso-callback">Callback URL sent to your identity provider</Label>
					<div className="flex gap-2">
						<Input
							id="sso-callback"
							value={provider.callbackUrl}
							readOnly
							className="font-mono text-xs"
							onClick={(event) => event.currentTarget.select()}
						/>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label="Copy callback URL"
							onClick={() => void copyCallbackUrl()}
						>
							<Copy className="h-4 w-4" />
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						Register this exact URL in your identity provider. The scheme, hostname, port, provider ID, and
						trailing slash must match.
					</p>
				</div>
				{discovery.data?.discoveryStatus === "issuer_mismatch" && (
					<Alert variant="warning">
						<AlertContent>
							<AlertTriangle className="h-4 w-4" />
							<AlertTitle>Issuer URLs do not match</AlertTitle>
							<AlertDescription>
								Discovery publishes{" "}
								<span className="break-all font-mono">{discovery.data?.discoveryIssuer}</span>.{" "}
								{discovery.data?.discoveryMessage}
							</AlertDescription>
						</AlertContent>
						{discoveredIssuer && (
							<AlertAction>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setValue("issuer", discoveredIssuer, { shouldDirty: true })}
								>
									Use discovered issuer
								</Button>
							</AlertAction>
						)}
					</Alert>
				)}
				{discovery.isError && (
					<Alert variant="warning">
						<AlertDescription>
							{parseError(discovery.error)?.message ?? "Could not check discovery."}
						</AlertDescription>
					</Alert>
				)}
				{discovery.data?.discoveryStatus === "unavailable" && (
					<Alert variant="warning">
						<AlertTitle>Discovery could not be checked</AlertTitle>
						<AlertDescription>
							{discovery.data?.discoveryMessage} You can still update the domain or rotate the secret.
						</AlertDescription>
					</Alert>
				)}
				{discovery.data?.discoveryStatus === "ok" && (
					<p className="flex items-center gap-2 text-sm text-muted-foreground">
						<CheckCircle2 className="h-4 w-4 text-green-500" />
						Saved issuer matches discovery.
					</p>
				)}
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="sso-edit-issuer">Issuer URL</Label>
						<Input
							id="sso-edit-issuer"
							type="url"
							required
							{...register("issuer")}
							disabled={update.isPending}
						/>
						<p className="text-xs text-muted-foreground">
							Copy the issuer exactly as published in the discovery document, including any trailing
							slash.
						</p>
					</div>
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="sso-edit-discovery">Discovery Endpoint</Label>
						<Input
							id="sso-edit-discovery"
							type="url"
							required
							{...register("discoveryEndpoint")}
							disabled={update.isPending || provider.hasLinkedAccounts}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="sso-edit-domain">Organization Domain</Label>
						<Input id="sso-edit-domain" required {...register("domain")} disabled={update.isPending} />
					</div>
					<div className="space-y-2">
						<Label htmlFor="sso-edit-client-id">Client ID</Label>
						<Input
							id="sso-edit-client-id"
							required
							{...register("clientId")}
							disabled={update.isPending || provider.hasLinkedAccounts}
						/>
					</div>
					<div className="space-y-2 sm:col-span-2">
						<Label htmlFor="sso-edit-secret">Client Secret</Label>
						<Input
							id="sso-edit-secret"
							type="password"
							autoComplete="new-password"
							{...register("clientSecret")}
							placeholder={
								provider.hasClientSecret
									? "Leave blank to keep the current secret"
									: "Enter a client secret"
							}
							disabled={update.isPending}
						/>
						<p className="text-xs text-muted-foreground">
							The saved secret is never displayed. Enter a replacement only when rotating it.
						</p>
					</div>
				</div>
				{provider.hasLinkedAccounts && (
					<p className="text-xs text-muted-foreground">
						This provider has linked accounts. Its client ID and discovery endpoint are locked. You can
						correct an issuer's trailing slash after discovery confirms the exact value.
					</p>
				)}
				{identityChangeError && (
					<Alert variant="warning">
						<AlertDescription>{identityChangeError}</AlertDescription>
					</Alert>
				)}
				{update.isError && (
					<Alert variant="destructive">
						<AlertTitle>Changes could not be saved</AlertTitle>
						<AlertDescription>{parseError(update.error)?.message ?? "Please try again."}</AlertDescription>
					</Alert>
				)}
			</div>
			<DialogFooter className="gap-2 border-t pt-4 shrink-0">
				<Button
					type="button"
					variant="ghost"
					loading={discovery.isFetching}
					disabled={update.isPending}
					onClick={() => void discovery.refetch()}
				>
					<RefreshCw className="h-4 w-4 mr-2" />
					Check saved configuration
				</Button>
				<Button type="button" variant="outline" disabled={update.isPending} onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" loading={update.isPending} disabled={!isDirty || identityChangeError !== null}>
					Save changes
				</Button>
			</DialogFooter>
		</form>
	);
}
