import { LifeBuoy, LogOut } from "lucide-react";
import { toast } from "sonner";
import { type AppContext } from "~/context";
import { GridBackground } from "./grid-background";
import { Button } from "./ui/button";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { authClient } from "../lib/auth-client";
import { DevPanelListener } from "./dev-panel-listener";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { AppBreadcrumb } from "./app-breadcrumb";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { ThemeToggle } from "./theme-toggle";

type Props = {
	loaderData: AppContext;
};

export function Layout({ loaderData }: Props) {
	const navigate = useNavigate();

	const handleLogout = async () => {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					void navigate({ to: "/login", replace: true });
				},
				onError: ({ error }) => {
					toast.error("Logout failed", { description: error.message });
				},
			},
		});
	};

	return (
		<SidebarProvider defaultOpen={loaderData.sidebarOpen}>
			<AppSidebar isInstanceAdmin={loaderData.user?.role === "admin"} />
			<div className="w-full relative flex flex-col min-h-screen md:h-screen md:overflow-hidden">
				<header className="z-50 bg-card-header border-b border-border/80 dark:border-border/50 shrink-0 h-16.25">
					<div className="flex items-center h-full justify-between px-2 sm:px-8 mx-auto container gap-4">
						<div className="flex items-center gap-4 min-w-0">
							<SidebarTrigger />
							<AppBreadcrumb />
						</div>
						{loaderData.user && (
							<div className="flex items-center bg-card dark:bg-muted/30 border border-border/80 dark:border-border/50 px-2 py-1 rounded-full shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] dark:shadow-sm">
								<span className="text-sm text-muted-foreground hidden md:inline-flex pl-2 mr-5">
									<span className="text-foreground">{loaderData.user.name}</span>
								</span>
								<ThemeToggle />
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="rounded-full h-7 text-xs text-muted-foreground hover:text-foreground"
											onClick={handleLogout}
										>
											<LogOut className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Logout</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="ghost"
											size="icon"
											className="relative overflow-hidden hidden lg:inline-flex rounded-full h-7 w-7 text-muted-foreground hover:text-foreground"
										>
											<a
												href="https://github.com/nicotsx/zerobyte/issues/new"
												target="_blank"
												rel="noreferrer"
												className="flex items-center justify-center w-full h-full"
											>
												<LifeBuoy className="w-4 h-4" />
											</a>
										</Button>
									</TooltipTrigger>
									<TooltipContent>Report an issue</TooltipContent>
								</Tooltip>
							</div>
						)}
					</div>
				</header>
				<div className="main-content flex-1 md:overflow-y-auto">
					<GridBackground>
						<main className="flex flex-col p-2 pb-6 pt-2 sm:p-8 sm:pt-6 mx-auto">
							<Outlet />
						</main>
					</GridBackground>
				</div>
			</div>
			<DevPanelListener />
		</SidebarProvider>
	);
}
