import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Ban, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSsoInvitationMutation,
	deleteSsoProviderMutation,
	getSsoSettingsOptions,
	updateSsoProviderAutoLinkingMutation,
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
import { Alert, AlertDescription } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Switch } from "~/client/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { formatDateWithMonth } from "~/client/lib/datetime";
import { getOrigin } from "~/client/functions/get-origin";
import { authClient } from "~/client/lib/auth-client";
import { cn } from "~/client/lib/utils";

type InvitationRole = "member" | "admin" | "owner";

export function SsoSettingsSection() {
	const origin = getOrigin();
	const navigate = useNavigate();
	const { activeOrganization } = useOrganizationContext();
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<InvitationRole>("member");

	const ssoSettingsQuery = useSuspenseQuery({
		...getSsoSettingsOptions(),
	});

	const updateProviderAutoLinkingMutation = useMutation({
		...updateSsoProviderAutoLinkingMutation(),
		onSuccess: (_, v) => {
			toast.success(v.body?.enabled ? "Automatic account linking enabled" : "Automatic account linking disabled");
		},
		onError: (error) => {
			toast.error("Failed to update provider", { description: error.message });
		},
	});

	const deleteProviderMutation = useMutation({
		...deleteSsoProviderMutation(),
		onSuccess: () => {
			toast.success("SSO provider deleted");
		},
		onError: (error) => {
			toast.error("Failed to delete provider", { description: error.message });
		},
	});

	const inviteMemberMutation = useMutation({
		mutationFn: async () => {
			if (!activeOrganization) {
				throw new Error("No active organization found in session");
			}

			const normalizedEmail = inviteEmail.trim().toLowerCase();
			if (!normalizedEmail) {
				throw new Error("Email is required");
			}

			const { error } = await authClient.organization.inviteMember({
				email: normalizedEmail,
				role: inviteRole,
				organizationId: activeOrganization.id,
			});

			if (error) {
				throw error;
			}
		},
		onSuccess: () => {
			toast.success("Invitation created");
			setInviteEmail("");
			setInviteRole("member");
		},
		onError: (error) => {
			toast.error("Failed to create invitation", { description: error.message });
		},
	});

	const cancelInvitationMutation = useMutation({
		mutationFn: async (invitationId: string) => {
			const { error } = await authClient.organization.cancelInvitation({ invitationId });
			if (error) {
				throw error;
			}
		},
		onSuccess: () => {
			toast.success("Invitation cancelled");
		},
		onError: (error) => {
			toast.error("Failed to cancel invitation", { description: error.message });
		},
	});

	const deleteInvitationMutation = useMutation({
		...deleteSsoInvitationMutation(),
		onSuccess: () => {
			toast.success("Invitation deleted");
		},
		onError: (error) => {
			toast.error("Failed to delete invitation", { description: error.message });
		},
	});

	const providers = ssoSettingsQuery.data.providers;
	const invitations = ssoSettingsQuery.data.invitations;

	return (
		<div className="space-y-6">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div className="space-y-1">
						<p className="text-sm font-medium">Registered providers</p>
						<p className="text-xs text-muted-foreground">Manage identity providers used for organization sign-in.</p>
					</div>

					<Button
						type="button"
						disabled={!activeOrganization}
						onClick={() => void navigate({ to: "/settings/sso/new" })}
					>
						Register new
					</Button>
				</div>

				<Alert variant="warning">
					<AlertDescription>
						Only enable automatic account linking for identity providers you trust. You can change this per provider at
						any time.
					</AlertDescription>
				</Alert>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Provider ID</TableHead>
								<TableHead>Domain</TableHead>
								<TableHead>Issuer</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Auto-link existing account</TableHead>
								<TableHead>Callback URL</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{providers.map((provider) => (
								<TableRow key={provider.providerId}>
									<TableCell className="font-medium">{provider.providerId}</TableCell>
									<TableCell>{provider.domain}</TableCell>
									<TableCell className="break-all">{provider.issuer}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<span className="uppercase text-xs font-medium px-2 py-0.5 rounded border">{provider.type}</span>
										</div>
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Switch
												checked={provider.autoLinkMatchingEmails}
												disabled={updateProviderAutoLinkingMutation.isPending}
												onCheckedChange={(enabled) => {
													updateProviderAutoLinkingMutation.mutate({
														path: { providerId: provider.providerId },
														body: { enabled },
													});
												}}
											/>
											<span className="text-xs text-muted-foreground">
												{provider.autoLinkMatchingEmails ? "On" : "Off"}
											</span>
										</div>
									</TableCell>
									<TableCell>
										<Input
											type="text"
											readOnly
											value={`${origin}/api/auth/sso/callback/${provider.providerId}`}
											className="h-8 max-w-62.5 font-mono text-xs text-muted-foreground"
											onClick={(e) => e.currentTarget.select()}
										/>
									</TableCell>
									<TableCell className="text-right">
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													title="Delete provider"
													loading={deleteProviderMutation.isPending}
													disabled={deleteProviderMutation.isPending}
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Delete SSO provider</AlertDialogTitle>
													<AlertDialogDescription>
														Are you sure you want to delete the SSO provider <strong>{provider.providerId}</strong>?
														This action cannot be undone.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogAction
														className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
														onClick={() => deleteProviderMutation.mutate({ path: { providerId: provider.providerId } })}
													>
														Delete
													</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									</TableCell>
								</TableRow>
							))}
							<TableRow className={cn({ hidden: providers.length > 0 })}>
								<TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
									No providers registered yet.
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</div>
			</div>

			<div className="space-y-4 border-t border-border/50 pt-6">
				<div className="space-y-1.5">
					<p className="text-sm font-medium">Invite-only access</p>
					<p className="text-xs text-muted-foreground">
						Users must be invited or already have an account before they can sign in using SSO.
					</p>
				</div>

				<div className="grid gap-3 @md:grid-cols-[minmax(0,1fr)_180px_auto]">
					<div className="space-y-2">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							id="invite-email"
							type="email"
							value={inviteEmail}
							onChange={(event) => setInviteEmail(event.target.value)}
							placeholder="teammate@example.com"
							disabled={!activeOrganization || inviteMemberMutation.isPending}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="invite-role">Role</Label>
						<Select
							value={inviteRole}
							onValueChange={(value) => setInviteRole(value as InvitationRole)}
							disabled={!activeOrganization || inviteMemberMutation.isPending}
						>
							<SelectTrigger id="invite-role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="member">Member</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
								<SelectItem value="owner">Owner</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex items-end">
						<Button
							type="button"
							loading={inviteMemberMutation.isPending}
							onClick={() => inviteMemberMutation.mutate()}
							disabled={!activeOrganization}
						>
							Invite
						</Button>
					</div>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Email</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{invitations.map((invitation) => (
								<TableRow key={invitation.id}>
									<TableCell className="font-medium">{invitation.email}</TableCell>
									<TableCell className="uppercase">{invitation.role}</TableCell>
									<TableCell>
										<span
											className={cn(`text-xs font-medium px-2 py-0.5 rounded border`, {
												"bg-primary/10 border-primary/20": invitation.status === "pending",
												"bg-muted border-muted-foreground/20": invitation.status !== "pending",
											})}
										>
											{invitation.status}
										</span>
									</TableCell>
									<TableCell>{formatDateWithMonth(invitation.expiresAt)}</TableCell>
									<TableCell className="text-right">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											title="Cancel invitation"
											loading={cancelInvitationMutation.isPending}
											disabled={cancelInvitationMutation.isPending}
											onClick={() => cancelInvitationMutation.mutate(invitation.id)}
											className={cn({ hidden: invitation.status !== "pending" })}
										>
											<Ban className="h-4 w-4" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											title="Delete invitation"
											loading={deleteInvitationMutation.isPending}
											disabled={deleteInvitationMutation.isPending}
											onClick={() => deleteInvitationMutation.mutate({ path: { invitationId: invitation.id } })}
											className={cn({ hidden: invitation.status === "pending" })}
										>
											<Trash2 className="h-4 w-4 text-destructive" />
										</Button>
									</TableCell>
								</TableRow>
							))}
							<TableRow className={cn({ hidden: invitations.length > 0 })}>
								<TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
									No invitations yet.
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}
