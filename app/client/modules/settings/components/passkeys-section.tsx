import { useState } from "react";
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
import { authClient } from "~/client/lib/auth-client";
import { logger } from "~/client/lib/logger";
import { useTimeFormat } from "~/client/lib/datetime";

type PasskeyEntry = {
	id: string;
	name?: string | null;
	createdAt: Date | string;
	deviceType?: string;
};

export function PasskeysSection() {
	const { formatDateTime } = useTimeFormat();
	const { data: passkeys, isPending, refetch } = authClient.useListPasskeys();

	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [newPasskeyName, setNewPasskeyName] = useState("");
	const [isAdding, setIsAdding] = useState(false);

	const [renameTarget, setRenameTarget] = useState<PasskeyEntry | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [isRenaming, setIsRenaming] = useState(false);

	const [deleteTarget, setDeleteTarget] = useState<PasskeyEntry | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleAddPasskey = async (e: React.FormEvent) => {
		e.preventDefault();
		setIsAdding(true);
		try {
			const { error } = await authClient.passkey.addPasskey({
				name: newPasskeyName.trim() || undefined,
			});
			if (error) {
				logger.error(error);
				toast.error("Failed to add passkey", { description: error.message });
				return;
			}
			toast.success("Passkey added");
			setAddDialogOpen(false);
			setNewPasskeyName("");
			await refetch();
		} catch (err) {
			logger.error(err);
			toast.error("Failed to add passkey", {
				description: err instanceof Error ? err.message : "Unknown error",
			});
		} finally {
			setIsAdding(false);
		}
	};

	const handleRename = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!renameTarget) return;
		const name = renameValue.trim();
		if (!name) {
			toast.error("Name is required");
			return;
		}
		setIsRenaming(true);
		const { error } = await authClient.$fetch("/passkey/update-passkey", {
			method: "POST",
			body: { id: renameTarget.id, name },
		});
		setIsRenaming(false);
		if (error) {
			logger.error(error);
			toast.error("Failed to rename passkey", { description: error.message });
			return;
		}
		toast.success("Passkey renamed");
		setRenameTarget(null);
		setRenameValue("");
		await refetch();
	};

	const handleDelete = async () => {
		if (!deleteTarget) return;
		setIsDeleting(true);
		const { error } = await authClient.$fetch("/passkey/delete-passkey", {
			method: "POST",
			body: { id: deleteTarget.id },
		});
		setIsDeleting(false);
		if (error) {
			logger.error(error);
			toast.error("Failed to delete passkey", { description: error.message });
			return;
		}
		toast.success("Passkey deleted");
		setDeleteTarget(null);
		await refetch();
	};

	const list = (passkeys ?? []) as PasskeyEntry[];

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<Fingerprint className="size-5" />
					Passkeys
				</CardTitle>
				<CardDescription className="mt-1.5">
					Sign in faster and more securely with passkeys stored on your device or password manager. You can add more
					than one.
				</CardDescription>
			</div>
			<CardContent className="p-6 space-y-4">
				<div className="flex items-start justify-between gap-4">
					<p className="text-xs text-muted-foreground max-w-xl">
						Passkeys use your device's biometrics or screen lock instead of a password. They are phishing-resistant and
						cannot be reused across sites.
					</p>
					<Button onClick={() => setAddDialogOpen(true)}>
						<Plus className="h-4 w-4 mr-2" />
						Add passkey
					</Button>
				</div>

				{isPending ? (
					<p className="text-sm text-muted-foreground">Loading passkeys...</p>
				) : list.length === 0 ? (
					<p className="text-sm text-muted-foreground">No passkeys yet. Add one to enable passwordless sign-in.</p>
				) : (
					<ul className="divide-y divide-border/50 rounded-md border border-border/50">
						{list.map((p) => (
							<li key={p.id} className="flex items-center justify-between gap-4 p-3">
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium truncate">{p.name?.trim() || "Unnamed passkey"}</p>
									<p className="text-xs text-muted-foreground">Added {formatDateTime(new Date(p.createdAt))}</p>
								</div>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setRenameTarget(p);
											setRenameValue(p.name ?? "");
										}}
									>
										<Pencil className="h-4 w-4" />
									</Button>
									<Button variant="destructive" size="sm" onClick={() => setDeleteTarget(p)}>
										<Trash2 className="h-4 w-4" />
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
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
									autoFocus
								/>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" loading={isAdding}>
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
									autoFocus
									required
								/>
							</div>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
								Cancel
							</Button>
							<Button type="submit" loading={isRenaming}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={Boolean(deleteTarget)}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete passkey?</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove "{deleteTarget?.name?.trim() || "this passkey"}" from your account. You won't be able to
							use it to sign in anymore.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(e) => {
								e.preventDefault();
								void handleDelete();
							}}
							disabled={isDeleting}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
