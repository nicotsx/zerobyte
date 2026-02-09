import { LifeBuoy } from "lucide-react";
import { Outlet, redirect, useNavigate } from "react-router";
import { toast } from "sonner";
import { appContext } from "~/context";
import { authMiddleware } from "~/middleware/auth";
import type { Route } from "./+types/layout";
import { AppBreadcrumb } from "./app-breadcrumb";
import { GridBackground } from "./grid-background";
import { Button } from "./ui/button";
import { SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { authClient } from "../lib/auth-client";
import { DevPanelListener } from "./dev-panel-listener";

export const clientMiddleware = [authMiddleware];

export async function clientLoader({ context }: Route.LoaderArgs) {
	const ctx = context.get(appContext);

	if (ctx.user && !ctx.user.hasDownloadedResticPassword) {
		throw redirect("/download-recovery-key");
	}

	return ctx;
}

export default function Layout({ loaderData }: Route.ComponentProps) {
	const navigate = useNavigate();

	const handleLogout = async () => {
		await authClient.signOut({
			fetchOptions: {
				onSuccess: () => {
					void navigate("/login", { replace: true });
				},
				onError: ({ error }) => {
					toast.error("Logout failed", { description: error.message });
				},
			},
		});
	};

	return (
		<SidebarProvider defaultOpen={true}>
			<AppSidebar />
			<div className="w-full relative flex flex-col h-screen overflow-hidden">
				<header className="z-50 bg-card-header border-b border-border/50 shrink-0">
					<div className="flex items-center justify-between py-3 sm:py-4 px-2 sm:px-8 mx-auto container gap-4">
						<div className="flex items-center gap-4 min-w-0">
							<SidebarTrigger />
							<AppBreadcrumb />
						</div>
						{loaderData.user && (
							<div className="flex items-center gap-4">
								<span className="text-sm text-muted-foreground hidden md:inline-flex">
									Welcome,&nbsp;
									<span className="text-strong-accent">{loaderData.user?.username}</span>
								</span>
								<Button variant="default" size="sm" onClick={handleLogout}>
									Logout
								</Button>
								<Button variant="default" size="sm" className="relative overflow-hidden hidden lg:inline-flex">
									<a
										href="https://github.com/nicotsx/zerobyte/issues/new"
										target="_blank"
										rel="noreferrer"
										className="flex items-center gap-2"
									>
										<span className="flex items-center gap-2">
											<LifeBuoy />
											<span>Report an issue</span>
										</span>
									</a>
								</Button>
							</div>
						)}
					</div>
				</header>
				<div className="main-content flex-1 overflow-y-auto">
					<GridBackground>
						<main className="flex flex-col p-2 pb-6 pt-2 sm:p-8 sm:pt-6 mx-auto @container">
							<Outlet />
						</main>
					</GridBackground>
				</div>
			</div>
			<DevPanelListener />
		</SidebarProvider>
	);
}
