import { useMutation, useQuery } from "@tanstack/react-query";
import { Shield, ShieldAlert, UserMinus, UserCheck, Trash2, Search, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "~/client/lib/auth-client";
import { Button } from "~/client/components/ui/button";
import { cn } from "~/client/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { Badge } from "~/client/components/ui/badge";
import { Input } from "~/client/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { CreateUserDialog } from "./create-user-dialog";
import { getUserDeletionImpactOptions } from "~/client/api-client/@tanstack/react-query.gen";

export function UserManagement() {
	const { data: session } = authClient.useSession();
	const currentUser = session?.user;

	const [search, setSearch] = useState("");
	const [userToDelete, setUserToDelete] = useState<string | null>(null);
	const [userToBan, setUserToBan] = useState<{ id: string; name: string; isBanned: boolean } | null>(null);

	const { data: deletionImpact, isLoading: isLoadingImpact } = useQuery({
		...getUserDeletionImpactOptions({ path: { userId: userToDelete ?? "" } }),
		enabled: Boolean(userToDelete),
	});

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["admin-users"],
		queryFn: async () => {
			const { data, error } = await authClient.admin.listUsers({ query: { limit: 100 } });
			if (error) throw error;
			return data;
		},
	});

	const setRoleMutation = useMutation({
		mutationFn: async ({ userId, role }: { userId: string; role: "user" | "admin" }) => {
			const { error } = await authClient.admin.setRole({ userId, role });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("User role updated successfully");
			void refetch();
		},
		onError: (err: any) => {
			toast.error("Failed to update role", { description: err.message });
		},
	});

	const toggleBanUserMutation = useMutation({
		mutationFn: async ({ userId, ban }: { userId: string; ban: boolean }) => {
			const { error } = ban ? await authClient.admin.banUser({ userId }) : await authClient.admin.unbanUser({ userId });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("User ban status updated successfully");
			void refetch();
		},
		onMutate: () => {
			setUserToBan(null);
		},
		onError: (err: any) => {
			toast.error("Failed to update ban status", { description: err.message });
		},
	});

	const filteredUsers = data?.users.filter(
		(user) =>
			user.name.toLowerCase().includes(search.toLowerCase()) ||
			user.email.toLowerCase().includes(search.toLowerCase()) ||
			(user as any).username?.toLowerCase().includes(search.toLowerCase()),
	);

	const handleDeleteUser = async () => {
		if (!userToDelete) return;

		try {
			const { error } = await authClient.admin.removeUser({ userId: userToDelete });
			if (error) throw error;
			toast.success("User deleted successfully");
			setUserToDelete(null);
			void refetch();
		} catch (err: any) {
			toast.error("Failed to delete user", { description: err.message });
		}
	};

	return (
		<div className="space-y-4 p-6">
			<div className="flex items-center justify-between gap-4">
				<div className="relative flex-1 max-w-sm">
					<Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="Search users..."
						className="pl-8"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>
				<CreateUserDialog onUserCreated={() => void refetch()} />
			</div>

			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>User</TableHead>
							<TableHead>Role</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow className={cn({ hidden: !isLoading })}>
							<TableCell colSpan={4} className="h-24 text-center">
								Loading users...
							</TableCell>
						</TableRow>
						<TableRow className={cn({ hidden: isLoading || (filteredUsers && filteredUsers.length > 0) })}>
							<TableCell colSpan={4} className="h-24 text-center">
								No users found.
							</TableCell>
						</TableRow>
						{filteredUsers?.map((user) => (
							<TableRow key={user.id}>
								<TableCell>
									<div className="flex flex-col">
										<span className="font-medium">{user.name}</span>
										<span className="text-sm text-muted-foreground">{user.email}</span>
									</div>
								</TableCell>
								<TableCell>
									<Badge>{user.role}</Badge>
								</TableCell>
								<TableCell>
									<Badge variant="outline" className={cn("text-red-500 border-red-500", { hidden: !user.banned })}>
										Banned
									</Badge>
									<Badge variant="outline" className={cn("text-green-600 border-green-600", { hidden: user.banned })}>
										Active
									</Badge>
								</TableCell>
								<TableCell className="text-right">
									<div className={cn("flex justify-end gap-2", { hidden: user.id === currentUser?.id })}>
										<Button
											variant="ghost"
											size="icon"
											title="Demote to User"
											className={cn({ hidden: user.role !== "admin" })}
											onClick={() => setRoleMutation.mutate({ userId: user.id, role: "user" })}
										>
											<ShieldAlert className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											title="Promote to Admin"
											className={cn({ hidden: user.role === "admin" })}
											onClick={() => setRoleMutation.mutate({ userId: user.id, role: "admin" })}
										>
											<Shield className="h-4 w-4" />
										</Button>

										<Button
											variant="ghost"
											size="icon"
											title="Unban User"
											className={cn({ hidden: !user.banned })}
											onClick={() => setUserToBan({ id: user.id, name: user.name, isBanned: true })}
										>
											<UserCheck className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											title="Ban User"
											className={cn({ hidden: !!user.banned })}
											onClick={() => setUserToBan({ id: user.id, name: user.name, isBanned: false })}
										>
											<UserMinus className="h-4 w-4" />
										</Button>

										<Button variant="ghost" size="icon" title="Delete User" onClick={() => setUserToDelete(user.id)}>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<Dialog open={Boolean(userToDelete)} onOpenChange={(open) => !open && setUserToDelete(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Are you absolutely sure?</DialogTitle>
						<DialogDescription>
							This action cannot be undone. This will permanently delete the user account and remove their data from our
							servers.
						</DialogDescription>
					</DialogHeader>

					<div className={cn("space-y-4", { hidden: !deletionImpact?.organizations.length })}>
						<div className="flex items-start gap-3 p-3 text-sm border rounded-lg bg-destructive/10 border-destructive/20 text-destructive">
							<AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
							<div className="space-y-1">
								<p className="font-semibold">Important: Data Deletion</p>
								<p>
									The following personal organizations and all their associated resources will be permanently deleted:
								</p>
							</div>
						</div>

						<div className="space-y-3 overflow-y-auto max-h-48">
							{deletionImpact?.organizations.map((org) => (
								<div key={org.id} className="p-3 border rounded-md bg-muted/50">
									<p className="font-medium">{org.name}</p>
									<div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
										<span>{org.resources.volumesCount} Volumes</span>
										<span>{org.resources.repositoriesCount} Repositories</span>
										<span>{org.resources.backupSchedulesCount} Backups</span>
									</div>
								</div>
							))}
						</div>
					</div>

					<div className={cn("text-center py-4", { hidden: !isLoadingImpact })}>
						<p className="text-sm text-muted-foreground">Analyzing deletion impact...</p>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setUserToDelete(null)}>
							Cancel
						</Button>
						<Button variant="destructive" disabled={isLoadingImpact} onClick={handleDeleteUser}>
							Delete User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={Boolean(userToBan)} onOpenChange={(open) => !open && setUserToBan(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{userToBan?.isBanned ? "Unban" : "Ban"} User</DialogTitle>
						<DialogDescription>
							Are you sure you want to {userToBan?.isBanned ? "unban" : "ban"} {userToBan?.name}?
							{userToBan?.isBanned
								? " They will regain access to the system."
								: " They will be immediately signed out and lose access."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setUserToBan(null)}>
							Cancel
						</Button>
						<Button
							variant="default"
							className={cn({ hidden: !userToBan?.isBanned })}
							onClick={() => toggleBanUserMutation.mutate({ userId: userToBan!.id, ban: false })}
						>
							Unban User
						</Button>
						<Button
							variant="destructive"
							className={cn({ hidden: !!userToBan?.isBanned })}
							onClick={() => toggleBanUserMutation.mutate({ userId: userToBan!.id, ban: true })}
						>
							Ban User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
