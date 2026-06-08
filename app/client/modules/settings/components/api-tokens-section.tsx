import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { CodeBlock } from "~/client/components/ui/code-block";
import { authClient } from "~/client/lib/auth-client";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { useTimeFormat } from "~/client/lib/datetime";
import { logger } from "~/client/lib/logger";
import { cn } from "~/client/lib/utils";

type ApiTokenEntry = {
	id: string;
	name?: string | null;
	start?: string | null;
	prefix?: string | null;
	createdAt: Date | string;
	expiresAt?: Date | string | null;
	lastRequest?: Date | string | null;
};

const EXPIRATION_OPTIONS = [
	{ value: "30", label: "30 days" },
	{ value: "90", label: "90 days" },
	{ value: "365", label: "1 year" },
	{ value: "never", label: "No expiration" },
] as const;

type ExpirationValue = (typeof EXPIRATION_OPTIONS)[number]["value"];

export function ApiTokensSection() {
	const { formatDateTime } = useTimeFormat();
	const { activeOrganization } = useOrganizationContext();

	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newTokenName, setNewTokenName] = useState("");
	const [newTokenExpiration, setNewTokenExpiration] = useState<ExpirationValue>("365");
	const [createdToken, setCreatedToken] = useState<string | null>(null);

	const [deleteTarget, setDeleteTarget] = useState<ApiTokenEntry | null>(null);

	const { data: tokens, isPending } = useQuery({
		queryKey: ["api-tokens"],
		queryFn: async (): Promise<ApiTokenEntry[]> => {
			const { data, error } = await authClient.apiKey.list();
			if (error) throw error;
			return data?.apiKeys ?? [];
		},
	});

	const createTokenMutation = useMutation({
		mutationFn: async (payload: { name: string; expiresIn: number | null }) => {
			const { data, error } = await authClient.apiKey.create({
				name: payload.name,
				expiresIn: payload.expiresIn ?? undefined,
				metadata: { organizationId: activeOrganization.id },
			});
			if (error) throw error;
			return data;
		},
		onSuccess: (data) => {
			toast.success("API token created");
			setCreatedToken(data?.key ?? null);
			setNewTokenName("");
		},
		onError: (error: Error) => {
			logger.error(error);
			toast.error("Failed to create API token", { description: error.message });
		},
	});

	const deleteTokenMutation = useMutation({
		mutationFn: async (id: string) => {
			const { error } = await authClient.apiKey.delete({ keyId: id });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("API token revoked");
			setDeleteTarget(null);
		},
		onError: (error: Error) => {
			logger.error(error);
			toast.error("Failed to revoke API token", { description: error.message });
		},
	});

	const handleCreate = (e: React.SyntheticEvent) => {
		e.preventDefault();
		const name = newTokenName.trim();
		if (!name) {
			toast.error("Name is required");
			return;
		}
		const expiresIn = newTokenExpiration === "never" ? null : Number(newTokenExpiration) * 24 * 60 * 60;
		createTokenMutation.mutate({ name, expiresIn });
	};

	const handleCopyToken = async () => {
		if (!createdToken) return;
		try {
			await navigator.clipboard.writeText(createdToken);
			toast.success("Copied to clipboard");
		} catch (error) {
			logger.error(error);
			toast.error("Failed to copy");
		}
	};

	const closeCreateDialog = (open: boolean) => {
		if (open) {
			setCreateDialogOpen(true);
			return;
		}
		setCreateDialogOpen(false);
		setCreatedToken(null);
		setNewTokenName("");
		setNewTokenExpiration("365");
	};

	const sortedTokens = useMemo(() => {
		if (!tokens) return [];
		return [...tokens].sort((a, b) => {
			const ad = new Date(a.createdAt).getTime();
			const bd = new Date(b.createdAt).getTime();
			return bd - ad;
		});
	}, [tokens]);

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="size-5" />
					API Tokens
				</CardTitle>
				<CardDescription className="mt-1.5">
					Long-lived tokens for accessing the Zerobyte API programmatically
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<p className="text-xs text-muted-foreground max-w-xl">
						Tokens act on your behalf within the current organization. Send them as the{" "}
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">x-api-key</code> header on
						any API request.
					</p>
					<Button onClick={() => setCreateDialogOpen(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Create token
					</Button>
				</div>

				<p className={cn("text-sm text-muted-foreground", { hidden: !isPending })}>Loading tokens...</p>
				<p
					className={cn("text-sm text-muted-foreground", {
						hidden: isPending || sortedTokens.length > 0,
					})}
				>
					No API tokens yet. Create one to authenticate against the API.
				</p>
				<ul
					className={cn("divide-y divide-border/50 rounded-md border border-border/50", {
						hidden: sortedTokens.length === 0,
					})}
				>
					{sortedTokens.map((token) => (
						<li key={token.id} className="flex items-center justify-between gap-4 p-3">
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium truncate">{token.name?.trim() || "Unnamed token"}</p>
								<p className="text-xs text-muted-foreground">
									Added {formatDateTime(new Date(token.createdAt))}
									{token.expiresAt
										? ` · Expires ${formatDateTime(new Date(token.expiresAt))}`
										: " · No expiration"}
									{token.lastRequest
										? ` · Last used ${formatDateTime(new Date(token.lastRequest))}`
										: ""}
								</p>
							</div>
							<Button
								variant="destructive"
								size="sm"
								aria-label={`Revoke token ${token.name?.trim() || "Unnamed token"}`}
								title={`Revoke token ${token.name?.trim() || "Unnamed token"}`}
								onClick={() => setDeleteTarget(token)}
							>
								<Trash2 className="h-4 w-4" />
							</Button>
						</li>
					))}
				</ul>
			</CardContent>

			<Dialog open={createDialogOpen} onOpenChange={closeCreateDialog}>
				<DialogContent>
					{!createdToken ? (
						<form onSubmit={handleCreate}>
							<DialogHeader>
								<DialogTitle>Create API token</DialogTitle>
								<DialogDescription>
									This token will inherit your permissions in the current organization.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<div className="space-y-2">
									<Label htmlFor="api-token-name">Name</Label>
									<Input
										id="api-token-name"
										value={newTokenName}
										onChange={(e) => setNewTokenName(e.target.value)}
										placeholder="API Client Name"
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="api-token-expiration">Expiration</Label>
									<Select
										value={newTokenExpiration}
										onValueChange={(value) => setNewTokenExpiration(value as ExpirationValue)}
									>
										<SelectTrigger id="api-token-expiration">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{EXPIRATION_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							</div>
							<DialogFooter>
								<Button type="button" variant="outline" onClick={() => closeCreateDialog(false)}>
									Cancel
								</Button>
								<Button type="submit" loading={createTokenMutation.isPending}>
									<KeyRound className="h-4 w-4 mr-2" />
									Create token
								</Button>
							</DialogFooter>
						</form>
					) : (
						<>
							<DialogHeader>
								<DialogTitle>Token created</DialogTitle>
								<DialogDescription>
									Copy this token now. For security reasons it will not be shown again.
								</DialogDescription>
							</DialogHeader>
							<div className="space-y-4 py-4">
								<Alert>
									<KeyRound className="size-5" />
									<AlertTitle>Store it somewhere safe</AlertTitle>
									<AlertDescription>
										This is the only time you will see the full token value.
									</AlertDescription>
								</Alert>
								<CodeBlock code={createdToken} filename="API token" />
							</div>
							<DialogFooter>
								<Button type="button" variant="outline" onClick={handleCopyToken}>
									<Copy className="h-4 w-4 mr-2" />
									Copy to clipboard
								</Button>
								<Button type="button" onClick={() => closeCreateDialog(false)}>
									Done
								</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>

			<AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke API token?</AlertDialogTitle>
						<AlertDialogDescription>
							"{deleteTarget?.name?.trim() || "this token"}" will stop working immediately. Any clients
							still using it will start receiving 401 responses.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteTokenMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								if (deleteTarget) deleteTokenMutation.mutate(deleteTarget.id);
							}}
							disabled={deleteTokenMutation.isPending}
						>
							Revoke
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
