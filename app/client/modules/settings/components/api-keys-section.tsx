import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createApiKeyMutation,
	deleteApiKeyMutation,
	getApiKeysOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { GetApiKeysResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
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
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";

type Props = {
	hasCredentialPassword: boolean;
};

type ApiKey = GetApiKeysResponse["apiKeys"][number];

const EXPIRATION_OPTIONS = [
	{ value: "30", label: "30 days" },
	{ value: "90", label: "90 days" },
	{ value: "365", label: "1 year" },
	{ value: "never", label: "No expiration" },
] as const;

type ExpirationValue = (typeof EXPIRATION_OPTIONS)[number]["value"];

export function ApiKeysSection({ hasCredentialPassword }: Props) {
	const { formatDateTime } = useTimeFormat();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [newKeyExpiration, setNewKeyExpiration] = useState<ExpirationValue>("365");
	const [password, setPassword] = useState("");
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null);

	const { data, isPending } = useQuery(getApiKeysOptions());
	const apiKeys = data?.apiKeys ?? [];
	const limit = data?.limit ?? 10;

	const createKey = useMutation({
		...createApiKeyMutation(),
		onSuccess: (apiKey) => {
			toast.success("API key created");
			setCreatedKey(apiKey.key);
			setNewKeyName("");
			setPassword("");
		},
		onError: (error) => {
			toast.error("Failed to create API key", { description: error.message });
		},
	});

	const deleteKey = useMutation({
		...deleteApiKeyMutation(),
		onSuccess: () => {
			toast.success("API key revoked");
			setDeleteTarget(null);
		},
		onError: (error) => {
			toast.error("Failed to revoke API key", { description: error.message });
		},
	});

	const closeCreateDialog = () => {
		setCreateDialogOpen(false);
		setNewKeyName("");
		setNewKeyExpiration("365");
		setPassword("");
		setCreatedKey(null);
	};

	const handleCreate = (event: React.ChangeEvent) => {
		event.preventDefault();

		const name = newKeyName.trim();
		if (!name) {
			toast.error("Name is required");
			return;
		}

		if (!password) {
			toast.error("Password is required");
			return;
		}

		const expiresIn = newKeyExpiration === "never" ? null : Number(newKeyExpiration) * 24 * 60 * 60;
		createKey.mutate({ body: { name, password, expiresIn } });
	};

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<KeyRound className="size-5" />
					API Keys
				</CardTitle>
				<CardDescription className="mt-1.5">
					Create keys for API access to the active organization.
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<p className="text-sm font-medium">{apiKeys.length} active keys</p>
						<p className="text-xs text-muted-foreground">Limit {limit} keys for this organization.</p>
					</div>
					<Button
						type="button"
						disabled={!hasCredentialPassword || apiKeys.length >= limit}
						onClick={() => setCreateDialogOpen(true)}
					>
						<Plus className="h-4 w-4 mr-2" />
						Create key
					</Button>
				</div>

				<Alert variant="warning" className={cn({ hidden: hasCredentialPassword })}>
					<KeyRound className="size-5" />
					<AlertTitle>Local password required</AlertTitle>
					<AlertDescription>
						A local credential password is required before API keys can be created.
					</AlertDescription>
				</Alert>

				<p className={cn("text-sm text-muted-foreground", { hidden: !isPending })}>Loading API keys...</p>
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Created</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead>Last used</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableRow className={cn({ hidden: isPending || apiKeys.length > 0 })}>
								<TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
									No API keys yet.
								</TableCell>
							</TableRow>
							{apiKeys.map((apiKey) => (
								<TableRow key={apiKey.id}>
									<TableCell className="font-medium">{apiKey.name ?? "Unnamed key"}</TableCell>
									<TableCell>{formatDateTime(new Date(apiKey.createdAt))}</TableCell>
									<TableCell>
										{apiKey.expiresAt ? formatDateTime(new Date(apiKey.expiresAt)) : "Never"}
									</TableCell>
									<TableCell>
										{apiKey.lastRequestAt
											? formatDateTime(new Date(apiKey.lastRequestAt))
											: "Never"}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="icon"
											title="Revoke API key"
											aria-label={`Revoke API key ${apiKey.name ?? "Unnamed key"}`}
											onClick={() => setDeleteTarget(apiKey)}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</CardContent>

			<Dialog
				open={createDialogOpen}
				onOpenChange={(open) => {
					if (open) setCreateDialogOpen(true);
					else closeCreateDialog();
				}}
			>
				<DialogContent>
					<form onSubmit={handleCreate} className="min-w-0">
						<DialogHeader>
							<DialogTitle>{createdKey ? "API key created" : "Create API key"}</DialogTitle>
							<DialogDescription>
								{createdKey
									? "Save this key now. For security reasons it will not be shown again."
									: "The key is shown once after creation and cannot be revealed later."}
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className={cn("space-y-2", { hidden: Boolean(createdKey) })}>
								<Label htmlFor="api-key-name">Name</Label>
								<Input
									id="api-key-name"
									value={newKeyName}
									onChange={(event) => setNewKeyName(event.target.value)}
									maxLength={32}
									required
								/>
							</div>
							<div className={cn("space-y-2", { hidden: Boolean(createdKey) })}>
								<Label htmlFor="api-key-expiration">Expiration</Label>
								<Select
									value={newKeyExpiration}
									onValueChange={(value) => setNewKeyExpiration(value as ExpirationValue)}
								>
									<SelectTrigger id="api-key-expiration">
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
							<div className={cn("space-y-2", { hidden: Boolean(createdKey) })}>
								<Label htmlFor="api-key-password">Current password</Label>
								<Input
									id="api-key-password"
									type="password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									required
								/>
							</div>
							<div className={cn("min-w-0", { hidden: !createdKey })}>
								<div className="min-w-0 space-y-2">
									<Label htmlFor="created-api-key">API key</Label>
									<Input
										id="created-api-key"
										type="text"
										readOnly
										value={createdKey ?? ""}
										className="font-mono text-sm"
										onClick={(e) => e.currentTarget.select()}
									/>
								</div>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" onClick={closeCreateDialog} className={cn({ hidden: !createdKey })}>
								Done
							</Button>
							<span className={cn("flex items-center gap-2", { hidden: Boolean(createdKey) })}>
								<Button type="button" variant="outline" onClick={closeCreateDialog}>
									<X className="h-4 w-4 mr-2" />
									Cancel
								</Button>
								<Button type="submit" loading={createKey.isPending}>
									<KeyRound className="h-4 w-4 mr-2" />
									Create
								</Button>
							</span>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke API key?</AlertDialogTitle>
						<AlertDialogDescription>
							This will revoke "{deleteTarget?.name ?? "this key"}". Future requests using it will fail.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteKey.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								if (deleteTarget) {
									deleteKey.mutate({ path: { keyId: deleteTarget.id } });
								}
							}}
							disabled={deleteKey.isPending}
						>
							Revoke
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
