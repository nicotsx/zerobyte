import { ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "~/client/components/ui/sidebar";
import { authClient } from "~/client/lib/auth-client";
import { useMutation } from "@tanstack/react-query";
import { useOrganizationContext } from "../hooks/use-org-context";

function getOrganizationInitials(name?: string): string {
	const trimmedName = name?.trim();

	if (!trimmedName) {
		return "O";
	}

	return trimmedName
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part.charAt(0).toUpperCase())
		.join("");
}

export function OrganizationSwitcher() {
	const { isMobile } = useSidebar();
	const { organizations, activeOrganization } = useOrganizationContext();

	const switchOrganizationMutation = useMutation({
		mutationFn: async (organizationId: string) => {
			const { error } = await authClient.organization.setActive({ organizationId });
			if (error) throw new Error(error.message);
		},
		onError: (error) => {
			const message = error instanceof Error ? error.message : "Unexpected error while switching organizations";
			toast.error("Failed to switch organization", { description: message });
		},
	});

	if (organizations === undefined) {
		return null;
	}

	if (organizations.length <= 1) {
		return null;
	}

	return (
		<SidebarMenu className="mb-3">
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<SidebarMenuButton
							size="lg"
							className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						>
							<div className="bg-black text-sidebar-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg">
								{activeOrganization?.logo ? (
									<img
										src={activeOrganization.logo}
										alt={`${activeOrganization.name} logo`}
										className="size-full object-cover"
									/>
								) : (
									<span className="text-xs font-semibold">{getOrganizationInitials(activeOrganization?.name)}</span>
								)}
							</div>
							<div className="grid flex-1 text-left text-sm leading-tight">
								<span className="truncate font-medium">{activeOrganization?.name}</span>
								<span className="truncate text-xs">{organizations.length} organizations</span>
							</div>
							<ChevronsUpDown className="ml-auto group-data-[collapsible=icon]:hidden" />
						</SidebarMenuButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
						align="start"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuLabel className="text-muted-foreground text-xs">Organizations</DropdownMenuLabel>
						{organizations.map((organization) => (
							<DropdownMenuItem
								key={organization.id}
								onClick={() => switchOrganizationMutation.mutate(organization.id)}
								className="gap-2 p-2"
								disabled={switchOrganizationMutation.isPending}
							>
								<div className="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border">
									{organization.logo ? (
										<img src={organization.logo} alt={`${organization.name} logo`} className="size-full object-cover" />
									) : (
										<span className="text-[10px] font-semibold">{getOrganizationInitials(organization.name)}</span>
									)}
								</div>
								<span className="min-w-0 flex-1 truncate">{organization.name}</span>
								<DropdownMenuShortcut>{organization.id === activeOrganization?.id && "Current"}</DropdownMenuShortcut>
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
