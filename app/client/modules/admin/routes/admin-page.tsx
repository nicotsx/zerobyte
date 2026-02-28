import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Users, Settings as SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import {
	getRegistrationStatusOptions,
	setRegistrationStatusMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Card, CardContent, CardDescription, CardTitle } from "~/client/components/ui/card";
import { Label } from "~/client/components/ui/label";
import { Switch } from "~/client/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/client/components/ui/tabs";
import type { AppContext } from "~/context";
import { UserManagement } from "~/client/modules/settings/components/user-management";

type Props = {
	appContext: AppContext;
};

export function AdminPage({ appContext }: Props) {
	const { tab } = useSearch({ from: "/(dashboard)/admin/" });
	const activeTab = tab || "users";
	const navigate = useNavigate();

	const registrationStatus = useSuspenseQuery({
		...getRegistrationStatusOptions(),
	});

	const updateRegistrationStatusMutation = useMutation({
		...setRegistrationStatusMutation(),
		onSuccess: () => {
			toast.success("Registration settings updated");
		},
		onError: (error) => {
			toast.error("Failed to update registration settings", {
				description: error.message,
			});
		},
	});

	const onTabChange = (value: string) => {
		void navigate({ to: ".", search: () => ({ tab: value }) });
	};

	return (
		<div className="space-y-6">
			<Tabs value={activeTab} onValueChange={onTabChange} className="w-full">
				<TabsList>
					<TabsTrigger value="users">Users</TabsTrigger>
					<TabsTrigger value="system">System</TabsTrigger>
				</TabsList>

				<div className="mt-2">
					<TabsContent value="users" className="mt-0">
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<Users className="size-5" />
									User Management
								</CardTitle>
								<CardDescription className="mt-1.5">Manage users, roles and permissions</CardDescription>
							</div>
							<UserManagement currentUser={appContext.user} />
						</Card>
					</TabsContent>

					<TabsContent value="system" className="mt-0">
						<Card className="p-0 gap-0">
							<div className="border-b border-border/50 bg-card-header p-6">
								<CardTitle className="flex items-center gap-2">
									<SettingsIcon className="size-5" />
									System Settings
								</CardTitle>
								<CardDescription className="mt-1.5">Manage system-wide settings</CardDescription>
							</div>
							<CardContent className="p-6">
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="enable-registrations" className="text-base">
											Enable new user registrations
										</Label>
										<p className="text-sm text-muted-foreground max-w-2xl">When enabled, new users can sign up</p>
									</div>
									<Switch
										id="enable-registrations"
										checked={registrationStatus.data.enabled}
										onCheckedChange={(checked) =>
											updateRegistrationStatusMutation.mutate({ body: { enabled: checked } })
										}
										disabled={updateRegistrationStatusMutation.isPending}
									/>
								</div>
							</CardContent>
						</Card>
					</TabsContent>
				</div>
			</Tabs>
		</div>
	);
}
