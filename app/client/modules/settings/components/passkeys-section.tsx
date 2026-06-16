import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fingerprint, Plus, Trash2, Pencil } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "~/client/components/ui/tooltip";
import { getIsSecureContext } from "~/client/functions/is-secure-context";
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { useTimeFormat } from "~/client/lib/datetime";
import { cn } from "~/client/lib/utils";

type PasskeyEntry = {
	id: string;
	name?: string | null;
	createdAt: Date | string;
	deviceType?: string;
};

export function PasskeysSection() {
	const { formatDateTime } = useTimeFormat();
	const isSecureContext = getIsSecureContext();
	const { data: passkeys, isPending } = useQuery({
		queryKey: ["passkeys"],
		queryFn: async () => {
			const { data, error } = await authClient.passkey.listUserPasskeys();
			if (error) throw error;
			return data;
		},
	});

	const [deletePasskeyOpen, setDeletePasskeyOpen] = useState(false);
	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [newPasskeyName, setNewPasskeyName] = useState("");

	const [renameTarget, setRenameTarget] = useState<PasskeyEntry | null>(null);
	const [renameValue, setRenameValue] = useState("");

	const [deleteTarget, setDeleteTarget] = useState<PasskeyEntry | null>(null);

	const addPasskeyMutation = useMutation({
		mutationFn: async (name: string | undefined) => {
			const { error } = await authClient.passkey.addPasskey({ name });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Passkey added");
			setAddDialogOpen(false);
			setNewPasskeyName("");
		},
		onError: (error: Error) => {
			logger.error(error);
			toast.error("Failed to add passkey", { description: error.message });
		},
	});

	const renamePasskeyMutation = useMutation({
		mutationFn: async ({ id, name }: { id: string; name: string }) => {
			const { error } = await authClient.passkey.updatePasskey({ id, name });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("Passkey renamed");
			setRenameTarget(null);
			setRenameValue("");
		},
		onError: (error: Error) => {
			logger.error(error);
			toast.error("Failed to rename passkey", { description: error.message });
		},
	});

	const deletePasskeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const { error } = await authClient.passkey.deletePasskey({ id });
			if (error) throw error;
		},
		onMutate: () => {
			setDeletePasskeyOpen(false);
		},
		onSuccess: () => {
			toast.success("Passkey deleted");
			setDeleteTarget(null);
		},
		onError: (error: Error) => {
			logger.error(error);
			toast.error("Failed to delete passkey", { description: error.message });
		},
	});

	const handleAddPasskey = (e: React.ChangeEvent) => {
		e.preventDefault();
		if (!isSecureContext) return;

		const name = newPasskeyName.trim() || undefined;
		addPasskeyMutation.mutate(name);
	};

	const handleRename = (e: React.ChangeEvent) => {
		e.preventDefault();
		if (!renameTarget) return;
		const name = renameValue.trim();
		if (!name) {
			toast.error("Name is required");
			return;
		}
		renamePasskeyMutation.mutate({ id: renameTarget.id, name });
	};

	const handleDelete = () => {
		if (!deleteTarget) return;
		deletePasskeyMutation.mutate(deleteTarget.id);
	};

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Fingerprint className="size-5" />
					Passkeys
				</CardTitle>
				<CardDescription className="mt-1.5">
					Sign in faster and more securely with passkeys stored on your device or password manager. You can
					add more than one.
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<p className="text-xs text-muted-foreground max-w-xl">
						Passkeys use your device's biometrics or screen lock instead of a password. They are
						phishing-resistant and cannot be reused across sites.
					</p>
					<Tooltip>
						<TooltipTrigger asChild>
							<span className="inline-flex">
								<Button onClick={() => setAddDialogOpen(true)} disabled={!isSecureContext}>
									<Plus className="h-4 w-4 mr-2" />
									Add passkey
								</Button>
							</span>
						</TooltipTrigger>
						<TooltipContent className={cn({ hidden: isSecureContext })}>
							<p>Passkeys can only be added over HTTPS or from localhost.</p>
						</TooltipContent>
					</Tooltip>
				</div>

				<p className={cn("text-sm text-muted-foreground", { hidden: !isPending })}>Loading passkeys...</p>
				<p className={cn("text-sm text-muted-foreground", { hidden: passkeys && passkeys.length > 0 })}>
					No passkeys yet. Add one to enable passwordless sign-in.
				</p>
				<ul
					className={cn("divide-y divide-border/50 rounded-md border border-border/50", {
						hidden: passkeys?.length === 0,
					})}
				>
					{passkeys?.map((p) => (
						<li key={p.id} className="flex items-center justify-between gap-4 p-3">
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium truncate">{p.name?.trim() || "Unnamed passkey"}</p>
								<p className="text-xs text-muted-foreground">
									Added {formatDateTime(new Date(p.createdAt))}
								</p>
							</div>
							<div className="flex gap-2">
								<Button
									variant="outline"
									size="sm"
									aria-label={`Rename passkey ${p.name?.trim() || "Unnamed passkey"}`}
									title={`Rename passkey ${p.name?.trim() || "Unnamed passkey"}`}
									onClick={() => {
										setRenameTarget(p);
										setRenameValue(p.name ?? "");
									}}
								>
									<Pencil className="h-4 w-4" />
								</Button>
								<Button
									variant="destructive"
									size="sm"
									aria-label={`Delete passkey ${p.name?.trim() || "Unnamed passkey"}`}
									title={`Delete passkey ${p.name?.trim() || "Unnamed passkey"}`}
									onClick={() => {
										setDeleteTarget(p);
										setDeletePasskeyOpen(true);
									}}
								>
									<Trash2 className="h-4 w-4" />
								</Button>
							</div>
						</li>
					))}
				</ul>
			</CardContent>

			<Dialog
				open={addDialogOpen}
				onOpenChange={(open) => {
					setAddDialogOpen(open);
					if (!open) setNewPasskeyName("");
				}}
			>
				<DialogContent>
					<form onSubmit={handleAddPasskey}>
						<DialogHeader>
							<DialogTitle>Add a passkey</DialogTitle>
							<DialogDescription>
								Give this passkey a name so you can recognize it later (e.g. "MacBook Touch ID").
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="passkey-name">Name (optional)</Label>
								<Input
									id="passkey-name"
									value={newPasskeyName}
									onChange={(e) => setNewPasskeyName(e.target.value)}
									placeholder="My Laptop"
								/>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={addPasskeyMutation.isPending} disabled={!isSecureContext}>
								<Fingerprint className="h-4 w-4 mr-2" />
								Add passkey
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={Boolean(renameTarget)}
				onOpenChange={(open) => {
					if (!open) {
						setRenameTarget(null);
						setRenameValue("");
					}
				}}
			>
				<DialogContent>
					<form onSubmit={handleRename}>
						<DialogHeader>
							<DialogTitle>Rename passkey</DialogTitle>
							<DialogDescription>Choose a name to recognize this passkey.</DialogDescription>
						</DialogHeader>
						<div className="space-y-4 py-4">
							<div className="space-y-2">
								<Label htmlFor="passkey-rename">Name</Label>
								<Input
									id="passkey-rename"
									value={renameValue}
									onChange={(e) => setRenameValue(e.target.value)}
									required
								/>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
								Cancel
							</Button>
							<Button type="submit" loading={renamePasskeyMutation.isPending}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={deletePasskeyOpen} onOpenChange={setDeletePasskeyOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete passkey?</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove "{deleteTarget?.name?.trim() || "this passkey"}" from your account. You
							won't be able to use it to sign in anymore.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletePasskeyMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								handleDelete();
							}}
							disabled={deletePasskeyMutation.isPending}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
