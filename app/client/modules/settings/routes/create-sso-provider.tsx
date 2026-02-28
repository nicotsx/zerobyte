import { arktypeResolver } from "@hookform/resolvers/arktype";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type } from "arktype";
import { ShieldCheck, Plus } from "lucide-react";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { updateSsoProviderAutoLinkingMutation } from "~/client/api-client/@tanstack/react-query.gen";
import { Button } from "~/client/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/client/components/ui/card";
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
import { Switch } from "~/client/components/ui/switch";
import { authClient } from "~/client/lib/auth-client";
import { parseError } from "~/client/lib/errors";
import { useOrganizationContext } from "~/client/hooks/use-org-context";

const ssoProviderSchema = type({
	providerId: "string>=1",
	issuer: "string>=1",
	domain: "string>=1",
	clientId: "string>=1",
	clientSecret: "string>=1",
	discoveryEndpoint: "string>=1",
	linkMatchingEmails: "boolean",
});

type ProviderForm = typeof ssoProviderSchema.infer;

export function CreateSsoProviderPage() {
	const navigate = useNavigate();
	const formId = useId();
	const { activeOrganization } = useOrganizationContext();

	const form = useForm<ProviderForm>({
		resolver: arktypeResolver(ssoProviderSchema),
		defaultValues: {
			providerId: "",
			issuer: "",
			domain: "",
			clientId: "",
			clientSecret: "",
			discoveryEndpoint: "",
			linkMatchingEmails: false,
		},
	});

	const updateProviderAutoLinking = useMutation({
		...updateSsoProviderAutoLinkingMutation(),
	});

	const registerProvider = useMutation({
		mutationFn: async (formData: ProviderForm) => {
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

			await updateProviderAutoLinking
				.mutateAsync({
					path: { providerId: formData.providerId },
					body: { enabled: formData.linkMatchingEmails },
				})
				.catch((updateError) => {
					toast.warning("Auto-link setting could not be saved", {
						description: parseError(updateError)?.message,
					});
				});
		},
		onSuccess: () => {
			toast.success("SSO provider registered successfully");
			void navigate({ to: "/settings", search: { tab: "organization" } });
		},
		onError: (error) => {
			toast.error("Failed to register provider", { description: error.message });
		},
	});

	return (
		<div className="container mx-auto space-y-6">
			<Card>
				<CardHeader>
					<div className="flex items-center gap-3">
						<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
							<ShieldCheck className="w-5 h-5 text-primary" />
						</div>
						<CardTitle>Register SSO Provider</CardTitle>
					</div>
				</CardHeader>
				<CardContent className="space-y-6">
					<Form {...form}>
						<form
							id={formId}
							onSubmit={form.handleSubmit((values) => registerProvider.mutate(values))}
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
												<Input {...field} placeholder="acme-oidc" disabled={registerProvider.isPending} />
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
												<Input {...field} placeholder="example.com" disabled={registerProvider.isPending} />
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
												<Input {...field} placeholder="https://idp.example.com" disabled={registerProvider.isPending} />
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
													disabled={registerProvider.isPending}
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
												<Input {...field} placeholder="oidc-client-id" disabled={registerProvider.isPending} />
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
													disabled={registerProvider.isPending}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>

							<FormField
								control={form.control}
								name="linkMatchingEmails"
								render={({ field }) => (
									<FormItem className="rounded-md border p-4">
										<div className="flex items-start justify-between gap-4">
											<div className="space-y-1">
												<FormLabel>Link matching emails to existing accounts</FormLabel>
												<FormDescription>
													If enabled, users who sign in with this provider will automatically access their existing
													account when the email address matches.
												</FormDescription>
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
													disabled={registerProvider.isPending}
												/>
											</FormControl>
										</div>
										<FormMessage />
									</FormItem>
								)}
							/>
						</form>
					</Form>

					<div className="flex justify-end gap-2 pt-4 border-t">
						<Button
							type="button"
							variant="secondary"
							onClick={() => void navigate({ to: "/settings", search: { tab: "organization" } })}
						>
							Cancel
						</Button>
						<Button type="submit" form={formId} loading={registerProvider.isPending}>
							<Plus className="h-4 w-4 mr-2" />
							Register Provider
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
