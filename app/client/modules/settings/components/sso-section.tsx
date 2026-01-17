import { Plus, Shield, Link as LinkIcon, Link2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/client/components/ui/button";
import { CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { authClient } from "~/client/lib/auth-client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/client/components/ui/table";

interface SSOProvider {
	id: string;
	providerId: string;
	issuer: string;
	domain: string;
}

interface SSOSectionProps {
	providers: SSOProvider[];
	userAccounts: { providerId: string; userId: string }[];
}

export function SSOSection({ providers, userAccounts }: SSOSectionProps) {
	const [isRegistering, setIsRegistering] = useState(false);
	const [open, setOpen] = useState(false);

	const [providerId, setProviderId] = useState("");
	const [issuer, setIssuer] = useState("");
	const [domain, setDomain] = useState("");
	const [clientId, setClientId] = useState("");
	const [clientSecret, setClientSecret] = useState("");

	const handleRegister = async (e: React.FormEvent) => {
		e.preventDefault();

		await authClient.sso.register({
			providerId,
			issuer,
			domain,
			oidcConfig: {
				clientId,
				clientSecret,
			},
			fetchOptions: {
				onRequest: () => {
					setIsRegistering(true);
				},
				onResponse: () => {
					setIsRegistering(false);
				},
				onError: async ({ error }) => {
					toast.error("Failed to register SSO provider", { description: error.message });
				},
				onSuccess: async () => {
					toast.success("SSO provider registered successfully");
					window.location.reload();
				},
			},
		});
	};

	const callbackUrl = `${window.location.origin}/api/auth/sso/callback/${providerId || ":providerId"}`;

	const handleLink = async (providerId: string) => {
		await authClient.signIn.sso({
			providerId,
			callbackURL: window.location.href,
			fetchOptions: {
				onError: async ({ error }) => {
					toast.error("Failed to link SSO provider", { description: error.message });
				},
				onSuccess: async () => {
					toast.success("SSO provider linked successfully");
					window.location.reload();
				},
			},
		});
	};

	const handleUnlink = async (providerId: string) => {
		await authClient.unlinkAccount({
			providerId,
			fetchOptions: {
				onError: async ({ error }) => {
					toast.error("Failed to unlink SSO provider", { description: error.message });
				},
				onSuccess: async () => {
					toast.success("SSO provider unlinked successfully");
					window.location.reload();
				},
			},
		});
	};

	return (
		<>
			<div className="border-t border-border/50 bg-card-header p-6">
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<Shield className="size-5" />
							SSO Providers
						</CardTitle>
						<CardDescription className="mt-1.5">Manage Single Sign-On providers for your instance</CardDescription>
					</div>
					<Dialog open={open} onOpenChange={setOpen}>
						<DialogTrigger asChild>
							<Button variant="outline" size="sm">
								<Plus className="size-4 mr-2" />
								Add Provider
							</Button>
						</DialogTrigger>
						<DialogContent className="sm:max-w-md">
							<form onSubmit={handleRegister}>
								<DialogHeader>
									<DialogTitle>Add SSO Provider</DialogTitle>
									<DialogDescription>Enter the details of your OIDC provider.</DialogDescription>
								</DialogHeader>
								<div className="grid gap-4 py-4">
									<div className="grid gap-2">
										<Label htmlFor="providerId">Provider ID</Label>
										<Input
											id="providerId"
											value={providerId}
											onChange={(e) => setProviderId(e.target.value)}
											placeholder="e.g. google, okta-work"
											required
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="issuer">Issuer URL</Label>
										<Input
											id="issuer"
											value={issuer}
											onChange={(e) => setIssuer(e.target.value)}
											placeholder="https://accounts.google.com"
											required
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="domain">Domain</Label>
										<Input
											id="domain"
											value={domain}
											onChange={(e) => setDomain(e.target.value)}
											placeholder="example.com"
											required
										/>
									</div>
									<div className="grid gap-2">
										<Label htmlFor="clientId">Client ID</Label>
										<Input id="clientId" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
									</div>
									<div className="grid gap-2">
										<Label htmlFor="clientSecret">Client Secret</Label>
										<Input
											id="clientSecret"
											type="password"
											value={clientSecret}
											onChange={(e) => setClientSecret(e.target.value)}
											required
										/>
									</div>
									<div className="grid gap-2 mt-2">
										<Label className="text-xs text-muted-foreground uppercase">Callback URL</Label>
										<div className="p-2 bg-muted rounded text-xs break-all font-mono">{callbackUrl}</div>
										<p className="text-[10px] text-muted-foreground italic">
											Copy this URL to your Identity Provider configuration.
										</p>
									</div>
								</div>
								<DialogFooter>
									<Button type="submit" loading={isRegistering}>
										Register Provider
									</Button>
								</DialogFooter>
							</form>
						</DialogContent>
					</Dialog>
				</div>
			</div>
			<CardContent className="p-6">
				{providers.length === 0 ? (
					<p className="text-sm text-muted-foreground">No SSO providers configured.</p>
				) : (
					<div className="border rounded-md">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Provider ID</TableHead>
									<TableHead>Domain</TableHead>
									<TableHead>User id</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{providers.map((p) => {
									const linkedAccount = userAccounts.find((ua) => ua.providerId === p.providerId);

									return (
										<TableRow key={p.id}>
											<TableCell className="font-medium">{p.providerId}</TableCell>
											<TableCell>{p.domain}</TableCell>
											<TableCell>{linkedAccount ? linkedAccount.userId : "-"}</TableCell>
											<TableCell className="text-right">
												{linkedAccount ? (
													<Button variant="destructive" size="sm" onClick={() => handleUnlink(p.providerId)}>
														{<Link2 className="size-4 mr-2" />}
														Unlink your account
													</Button>
												) : (
													<Button variant="ghost" size="sm" onClick={() => handleLink(p.providerId)}>
														<LinkIcon className="size-4 mr-2" />
														Link your account
													</Button>
												)}
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</>
	);
}
