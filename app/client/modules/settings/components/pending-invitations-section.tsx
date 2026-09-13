import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { MailCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getUserSsoInvitationsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { startInvitationSsoVerification, type Options } from "~/client/api-client/sdk.gen";
import type { GetUserSsoInvitationsResponse, StartInvitationSsoVerificationData } from "~/client/api-client/types.gen";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/client/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";
import { useTimeFormat } from "~/client/lib/datetime";
import { parseError } from "~/client/lib/errors";
import { cn } from "~/client/lib/utils";
import { startSsoSignIn } from "~/client/modules/sso/start-sso-sign-in";

type UserInvitation = GetUserSsoInvitationsResponse[number];
type VerifyInvitationVariables = Options<StartInvitationSsoVerificationData>;

type Props = {
	initialInvitations: GetUserSsoInvitationsResponse;
	userEmail?: string | null;
};

export function PendingInvitationsSection({ initialInvitations, userEmail }: Props) {
	const { formatDateTime } = useTimeFormat();
	const [selectedInvitationProviders, setSelectedInvitationProviders] = useState<Record<string, string>>({});

	const { data: pendingInvitations } = useSuspenseQuery({
		...getUserSsoInvitationsOptions(),
		initialData: initialInvitations,
	});

	const verifyInvitation = useMutation({
		mutationFn: async (variables: VerifyInvitationVariables) => {
			await startInvitationSsoVerification({ ...variables, throwOnError: true });

			return startSsoSignIn({
				providerId: variables.body.providerId,
				callbackURL: "/settings",
				loginHint: userEmail ?? undefined,
			});
		},
		onSuccess: (url) => {
			window.location.href = url;
		},
		onError: (error) => {
			toast.error("Failed to start SSO verification", { description: parseError(error)?.message });
		},
	});

	const getSelectedInvitationProvider = (invitation: UserInvitation) => {
		return selectedInvitationProviders[invitation.id] ?? invitation.ssoProviders[0]?.providerId ?? "";
	};

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<CardTitle className="flex items-center gap-2">
					<MailCheck className="size-5" />
					Pending Invitations
				</CardTitle>
				<CardDescription className="mt-1.5">Organization invitations sent to this account</CardDescription>
			</div>
			<CardContent className="p-6">
				<div className="rounded-md border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Organization</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Expires</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pendingInvitations.map((invitation) => {
								const providerId = getSelectedInvitationProvider(invitation);
								const hasMultipleProviders = invitation.ssoProviders.length > 1;
								const isVerifying =
									verifyInvitation.isPending &&
									verifyInvitation.variables?.path.invitationId === invitation.id;

								return (
									<TableRow key={invitation.id}>
										<TableCell className="font-medium">{invitation.organizationName}</TableCell>
										<TableCell className="uppercase">{invitation.role}</TableCell>
										<TableCell>{formatDateTime(new Date(invitation.expiresAt))}</TableCell>
										<TableCell className="text-right">
											<div className="flex justify-end gap-2">
												{hasMultipleProviders && (
													<Select
														value={providerId}
														onValueChange={(nextProviderId) =>
															setSelectedInvitationProviders((current) => ({
																...current,
																[invitation.id]: nextProviderId,
															}))
														}
													>
														<SelectTrigger className="h-9 w-40" aria-label="SSO provider">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{invitation.ssoProviders.map((provider) => (
																<SelectItem
																	key={provider.providerId}
																	value={provider.providerId}
																>
																	{provider.providerId}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												)}
												<Button
													type="button"
													variant="outline"
													size="sm"
													title="Verify with SSO"
													loading={isVerifying}
													disabled={!providerId || verifyInvitation.isPending}
													onClick={() =>
														verifyInvitation.mutate({
															path: { invitationId: invitation.id },
															body: { providerId },
														})
													}
												>
													<ShieldCheck size={16} className="mr-2" />
													Verify
												</Button>
											</div>
										</TableCell>
									</TableRow>
								);
							})}
							<TableRow className={cn({ hidden: pendingInvitations.length > 0 })}>
								<TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
									No pending invitations.
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</>
	);
}
