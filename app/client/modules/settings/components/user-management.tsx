import { useQuery } from "@tanstack/react-query";
import { Shield, ShieldAlert, UserMinus, UserCheck, Trash2, Search } from "lucide-react";
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

export function UserManagement() {
	const { data: session } = authClient.useSession();
	const currentUser = session?.user;

	const [search, setSearch] = useState("");
	const [isDeleting, setIsDeleting] = useState<string | null>(null);
	const [isBanning, setIsBanning] = useState<{ id: string; name: string; isBanned: boolean } | null>(null);

	const { data, isLoading, refetch } = useQuery({
		queryKey: ["admin-users"],
		queryFn: async () => {
			const { data, error } = await authClient.admin.listUsers({ query: { limit: 100 } });
			if (error) throw error;
			return data;
		},
	});

	const filteredUsers = data?.users.filter(
		(user) =>
			user.name.toLowerCase().includes(search.toLowerCase()) ||
			user.email.toLowerCase().includes(search.toLowerCase()) ||
			(user as any).username?.toLowerCase().includes(search.toLowerCase()),
	);

	const handleSetRole = async (userId: string, role: "user" | "admin") => {
		try {
			const { error } = await authClient.admin.setRole({ userId, role });
			if (error) throw error;
			toast.success(`User role updated to ${role}`);
			void refetch();
		} catch (err: any) {
			toast.error("Failed to update role", { description: err.message });
		}
	};

	const handleBanUser = async () => {
		if (!isBanning) return;
		try {
			const { error } = isBanning.isBanned
				? await authClient.admin.unbanUser({ userId: isBanning.id })
				: await authClient.admin.banUser({ userId: isBanning.id });

			if (error) throw error;
			toast.success(`User ${isBanning.isBanned ? "unbanned" : "banned"} successfully`);
			setIsBanning(null);
			void refetch();
		} catch (err: any) {
			toast.error(`Failed to ${isBanning.isBanned ? "unban" : "ban"} user`, { description: err.message });
		}
	};

	const handleDeleteUser = async () => {
		if (!isDeleting) return;
		try {
			const { error } = await authClient.admin.removeUser({ userId: isDeleting });
			if (error) throw error;
			toast.success("User deleted successfully");
			setIsDeleting(null);
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
											onClick={() => handleSetRole(user.id, "user")}
										>
											<ShieldAlert className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											title="Promote to Admin"
											className={cn({ hidden: user.role === "admin" })}
											onClick={() => handleSetRole(user.id, "admin")}
										>
											<Shield className="h-4 w-4" />
										</Button>

										{/* Ban/Unban Actions */}
										<Button
											variant="ghost"
											size="icon"
											title="Unban User"
											className={cn({ hidden: !user.banned })}
											onClick={() => setIsBanning({ id: user.id, name: user.name, isBanned: true })}
										>
											<UserCheck className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											title="Ban User"
											className={cn({ hidden: !!user.banned })}
											onClick={() => setIsBanning({ id: user.id, name: user.name, isBanned: false })}
										>
											<UserMinus className="h-4 w-4" />
										</Button>

										<Button variant="ghost" size="icon" title="Delete User" onClick={() => setIsDeleting(user.id)}>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>

			<Dialog open={Boolean(isDeleting)} onOpenChange={(open) => !open && setIsDeleting(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Are you absolutely sure?</DialogTitle>
						<DialogDescription>
							This action cannot be undone. This will permanently delete the user account and remove their data from our
							servers.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsDeleting(null)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleDeleteUser}>
							Delete User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={Boolean(isBanning)} onOpenChange={(open) => !open && setIsBanning(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{isBanning?.isBanned ? "Unban" : "Ban"} User</DialogTitle>
						<DialogDescription>
							Are you sure you want to {isBanning?.isBanned ? "unban" : "ban"} {isBanning?.name}?
							{isBanning?.isBanned
								? " They will regain access to the system."
								: " They will be immediately signed out and lose access."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsBanning(null)}>
							Cancel
						</Button>
						<Button variant="default" className={cn({ hidden: !isBanning?.isBanned })} onClick={handleBanUser}>
							Unban User
						</Button>
						<Button variant="destructive" className={cn({ hidden: !!isBanning?.isBanned })} onClick={handleBanUser}>
							Ban User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
