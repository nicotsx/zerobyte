import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Shield, ShieldAlert, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getOrgMembersOptions,
	removeOrgMemberMutation,
	updateMemberRoleMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "~/client/components/ui/alert-dialog";
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { cn } from "~/client/lib/utils";

export function OrgMembersSection() {
	const { activeMember } = useOrganizationContext();
	const [memberToRemove, setMemberToRemove] = useState<{ id: string; name: string } | null>(null);

	const orgMembersQuery = useSuspenseQuery({
		...getOrgMembersOptions(),
	});

	const updateRole = useMutation({
		...updateMemberRoleMutation(),
		onSuccess: () => {
			toast.success("Member role updated");
		},
		onError: (error) => {
			toast.error("Failed to update role", { description: error.message });
		},
	});

	const removeMember = useMutation({
		...removeOrgMemberMutation(),
		onSuccess: () => {
			toast.success("Member removed from organization");
			setMemberToRemove(null);
		},
		onError: (error) => {
			toast.error("Failed to remove member", { description: error.message });
		},
	});

	const members = orgMembersQuery.data.members;

	return (
		<div className="space-y-4">
			<div className="rounded-md border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Member</TableHead>
							<TableHead>Role</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow className={cn({ hidden: members.length > 0 })}>
							<TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
								No members found.
							</TableCell>
						</TableRow>
						{members.map((member) => {
							const isOwner = member.role === "owner";
							const isSelf = member.id === activeMember?.id;

							return (
								<TableRow key={member.id}>
									<TableCell>
										<div className="flex flex-col">
											<span className="font-medium">{member.user.name ?? member.user.email}</span>
											<span className="text-sm text-muted-foreground">{member.user.email}</span>
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="outline">{member.role}</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-2">
											<Button
												variant="ghost"
												size="icon"
												title="Demote to Member"
												className={cn({ hidden: member.role !== "admin" || isSelf })}
												disabled={updateRole.isPending}
												onClick={() =>
													updateRole.mutate({
														path: { memberId: member.id },
														body: { role: "member" },
													})
												}
											>
												<ShieldAlert className="h-4 w-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												title="Promote to Admin"
												className={cn({ hidden: member.role !== "member" || isSelf })}
												disabled={updateRole.isPending}
												onClick={() =>
													updateRole.mutate({
														path: { memberId: member.id },
														body: { role: "admin" },
													})
												}
											>
												<Shield className="h-4 w-4" />
											</Button>

											<AlertDialog
												open={memberToRemove?.id === member.id}
												onOpenChange={(open) => !open && setMemberToRemove(null)}
											>
												<AlertDialogTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														title="Remove member"
														className={cn({ hidden: isOwner || isSelf })}
														onClick={() =>
															setMemberToRemove({
																id: member.id,
																name: member.user.name ?? member.user.email,
															})
														}
													>
														<Trash2 className="h-4 w-4 text-destructive" />
													</Button>
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>Remove member</AlertDialogTitle>
														<AlertDialogDescription>
															Are you sure you want to remove <strong>{memberToRemove?.name}</strong> from this
															organization? They will lose access to all organization resources.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
															disabled={removeMember.isPending}
															onClick={() => removeMember.mutate({ path: { memberId: memberToRemove!.id } })}
														>
															Remove
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
