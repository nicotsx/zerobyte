import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { type } from "arktype";
import { Ban, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
	deleteSsoInvitationMutation,
	deleteSsoProviderMutation,
	getSsoSettingsOptions,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertDescription } from "~/client/components/ui/alert";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "~/client/components/ui/form";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { authClient } from "~/client/lib/auth-client";
import { parseError } from "~/client/lib/errors";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { formatDateWithMonth } from "~/client/lib/datetime";
import { getOrigin } from "~/client/functions/get-origin";

const ssoProviderSchema = type({
	providerId: "string>=1",
	issuer: "string>=1",
	domain: "string>=1",
	clientId: "string>=1",
	clientSecret: "string>=1",
	discoveryEndpoint: "string>=1",
});

type ProviderForm = typeof ssoProviderSchema.infer;
type InvitationRole = "member" | "admin" | "owner";

export function SsoSettingsSection() {
	const origin = getOrigin();
	const { activeOrganization } = useOrganizationContext();
	const [isRegisterProviderDialogOpen, setIsRegisterProviderDialogOpen] = useState(false);
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<InvitationRole>("member");

	const form = useForm<ProviderForm>({
		resolver: arktypeResolver(ssoProviderSchema),
		defaultValues: {
			providerId: "",
			issuer: "",
			domain: "",
			clientId: "",
			clientSecret: "",
			discoveryEndpoint: "",
		},
	});

	const { data } = useSuspenseQuery({
		...getSsoSettingsOptions(),
	});

	const providers = data.providers;
	const invitations = data.invitations;

	const registerProviderMutation = useMutation({
		mutationFn: async (formData: ProviderForm) => {
			if (!activeOrganization) {
				throw new Error("No active organization found in session");
			}

			const { error } = await authClient.sso.register({
				providerId: formData.providerId,
				issuer: formData.issuer,
				domain: formData.domain,
				organizationId: activeOrganization.id,
				oidcConfig: {
					clientId: formData.clientId,
					clientSecret: formData.clientSecret,
					discoveryEndpoint: formData.discoveryEndpoint,
					scopes: ["openid", "email", "profile"],
				},
			});

			if (error) throw error;
		},
		onSuccess: () => {
			toast.success("SSO provider registered successfully");
			form.reset();
			setIsRegisterProviderDialogOpen(false);
		},
		onError: (error: unknown) => {
			toast.error("Failed to register provider", { description: parseError(error)?.message });
		},
	});

	const deleteProviderMutation = useMutation({
		...deleteSsoProviderMutation(),
		onSuccess: () => {
			toast.success("SSO provider deleted");
		},
		onError: (error) => {
			toast.error("Failed to delete provider", { description: parseError(error)?.message });
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
		onError: (error: unknown) => {
			toast.error("Failed to create invitation", { description: parseError(error)?.message });
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
		onError: (error: unknown) => {
			toast.error("Failed to cancel invitation", { description: parseError(error)?.message });
		},
	});

	const deleteInvitationMutation = useMutation({
		...deleteSsoInvitationMutation(),
		onSuccess: () => {
			toast.success("Invitation deleted");
		},
		onError: (error) => {
			toast.error("Failed to delete invitation", { description: parseError(error)?.message });
		},
	});

	return (
		<div className="space-y-6">
			<div className="space-y-3">
				<div className="flex items-center justify-between gap-3">
					<div className="space-y-1">
						<p className="text-sm font-medium">Registered providers</p>
						<p className="text-xs text-muted-foreground">Manage identity providers used for organization sign-in.</p>
					</div>

					<Dialog open={isRegisterProviderDialogOpen} onOpenChange={setIsRegisterProviderDialogOpen}>
						<DialogTrigger asChild>
							<Button type="button" disabled={!activeOrganization}>
								Register new
							</Button>
						</DialogTrigger>

						<DialogContent className="sm:max-w-2xl">
							<DialogHeader>
								<DialogTitle>Register SSO provider</DialogTitle>
								<DialogDescription>Connect an OIDC provider for the active organization.</DialogDescription>
							</DialogHeader>

							<Form {...form}>
								<form
									onSubmit={form.handleSubmit((values) => registerProviderMutation.mutate(values))}
									className="space-y-4"
								>
									<div className="grid gap-4 @xl:grid-cols-2">
										<FormField
											control={form.control}
											name="providerId"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Provider ID</FormLabel>
													<FormControl>
														<Input {...field} placeholder="acme-oidc" disabled={registerProviderMutation.isPending} />
													</FormControl>
													<FormDescription>Unique identifier used in callback URLs.</FormDescription>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="domain"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Organization Domain</FormLabel>
													<FormControl>
														<Input {...field} placeholder="example.com" disabled={registerProviderMutation.isPending} />
													</FormControl>
													<FormDescription>Used to discover providers during login.</FormDescription>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="issuer"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Issuer URL</FormLabel>
													<FormControl>
														<Input
															{...field}
															placeholder="https://idp.example.com"
															disabled={registerProviderMutation.isPending}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="discoveryEndpoint"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Discovery Endpoint</FormLabel>
													<FormControl>
														<Input
															{...field}
															placeholder="https://idp.example.com/.well-known/openid-configuration"
															disabled={registerProviderMutation.isPending}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="clientId"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Client ID</FormLabel>
													<FormControl>
														<Input
															{...field}
															placeholder="oidc-client-id"
															disabled={registerProviderMutation.isPending}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										<FormField
											control={form.control}
											name="clientSecret"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Client Secret</FormLabel>
													<FormControl>
														<Input
															{...field}
															type="password"
															placeholder="oidc-client-secret"
															disabled={registerProviderMutation.isPending}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>

									{!activeOrganization ? (
										<Alert variant="destructive">
											<AlertDescription>
												No active organization found. Select an organization before registering an SSO provider.
											</AlertDescription>
										</Alert>
									) : null}

									<div className="flex justify-end">
										<Button type="submit" loading={registerProviderMutation.isPending} disabled={!activeOrganization}>
											Register SSO Provider
										</Button>
									</div>
								</form>
							</Form>
						</DialogContent>
					</Dialog>
				</div>

				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Provider ID</TableHead>
								<TableHead>Domain</TableHead>
								<TableHead>Issuer</TableHead>
								<TableHead>Type</TableHead>
								<TableHead>Callback URL</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{providers && providers.length > 0 ? (
								providers.map((provider) => (
									<TableRow key={provider.providerId}>
										<TableCell className="font-medium">{provider.providerId}</TableCell>
										<TableCell>{provider.domain}</TableCell>
										<TableCell className="break-all">{provider.issuer}</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="uppercase">
													{provider.type}
												</Badge>
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
														loading={
															deleteProviderMutation.isPending &&
															deleteProviderMutation.variables?.path?.providerId === provider.providerId
														}
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
															onClick={() =>
																deleteProviderMutation.mutate({ path: { providerId: provider.providerId } })
															}
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
										No providers registered yet.
									</TableCell>
								</TableRow>
							)}
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
							{invitations.length > 0 ? (
								invitations.map((invitation) => (
									<TableRow key={invitation.id}>
										<TableCell className="font-medium">{invitation.email}</TableCell>
										<TableCell className="uppercase">{invitation.role}</TableCell>
										<TableCell>
											<Badge variant={invitation.status === "pending" ? "default" : "outline"}>
												{invitation.status}
											</Badge>
										</TableCell>
										<TableCell>{formatDateWithMonth(invitation.expiresAt)}</TableCell>
										<TableCell className="text-right">
											{invitation.status === "pending" ? (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													title="Cancel invitation"
													loading={
														cancelInvitationMutation.isPending && cancelInvitationMutation.variables === invitation.id
													}
													disabled={cancelInvitationMutation.isPending}
													onClick={() => cancelInvitationMutation.mutate(invitation.id)}
												>
													<Ban className="h-4 w-4" />
												</Button>
											) : (
												<Button
													type="button"
													variant="ghost"
													size="icon"
													title="Delete invitation"
													loading={
														deleteInvitationMutation.isPending &&
														deleteInvitationMutation.variables?.path?.invitationId === invitation.id
													}
													disabled={deleteInvitationMutation.isPending}
													onClick={() => deleteInvitationMutation.mutate({ path: { invitationId: invitation.id } })}
												>
													<Trash2 className="h-4 w-4 text-destructive" />
												</Button>
											)}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
										No invitations yet.
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	);
}
