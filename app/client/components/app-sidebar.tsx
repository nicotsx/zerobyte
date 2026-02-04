import { Bell, CalendarClock, Database, HardDrive, Settings } from "lucide-react";
import { useState } from "react";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "~/client/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/client/components/ui/tooltip";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/client/components/ui/hover-card";
import { cn } from "~/client/lib/utils";
import { APP_VERSION, RCLONE_VERSION, RESTIC_VERSION, SHOUTRRR_VERSION } from "~/client/lib/version";
import { useUpdates } from "~/client/hooks/use-updates";
import { ReleaseNotesDialog } from "./release-notes-dialog";
import { Link } from "@tanstack/react-router";

const items = [
	{
		title: "Volumes",
		url: "/volumes",
		icon: HardDrive,
	},
	{
		title: "Repositories",
		url: "/repositories",
		icon: Database,
	},
	{
		title: "Backups",
		url: "/backups",
		icon: CalendarClock,
	},
	{
		title: "Notifications",
		url: "/notifications",
		icon: Bell,
	},
	{
		title: "Settings",
		url: "/settings",
		icon: Settings,
	},
];

export function AppSidebar() {
	const { state } = useSidebar();
	const { updates, hasUpdate } = useUpdates();
	const [showReleaseNotes, setShowReleaseNotes] = useState(false);

	const displayVersion = APP_VERSION.startsWith("v") || APP_VERSION === "dev" ? APP_VERSION : `v${APP_VERSION}`;
	const releaseUrl =
		APP_VERSION === "dev"
			? "https://github.com/nicotsx/zerobyte"
			: `https://github.com/nicotsx/zerobyte/releases/tag/${displayVersion}`;

	return (
		<Sidebar variant="inset" collapsible="icon" className="p-0">
			<SidebarHeader className="bg-card-header border-b border-border/50 hidden md:flex h-16.25 flex-row items-center p-4">
				<Link to="/volumes" className="flex items-center gap-3 font-semibold pl-2">
					<img src="/images/zerobyte.png" alt="Zerobyte Logo" className={cn("h-8 w-8 shrink-0 object-contain -ml-2")} />
					<span
						className={cn("text-base transition-all duration-200 -ml-1", {
							"opacity-0 w-0 overflow-hidden ": state === "collapsed",
						})}
					>
						Zerobyte
					</span>
				</Link>
			</SidebarHeader>
			<SidebarContent className="p-2 border-r">
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{items.map((item) => (
								<SidebarMenuItem key={item.title}>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<SidebarMenuButton asChild>
													<Link to={item.url}>
														{({ isActive }) => (
															<>
																<item.icon className={cn({ "text-strong-accent": isActive })} />
																<span className={cn({ "text-strong-accent": isActive })}>{item.title}</span>
															</>
														)}
													</Link>
												</SidebarMenuButton>
											</TooltipTrigger>
											<TooltipContent side="right" className={cn({ hidden: state !== "collapsed" })}>
												<p>{item.title}</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="p-4 border-r border-t border-border/50">
				<div className="flex items-center justify-between gap-2">
					<HoverCard openDelay={200}>
						<HoverCardTrigger asChild>
							<a
								href={releaseUrl}
								target="_blank"
								rel="noopener noreferrer"
								className={cn("text-xs text-muted-foreground hover:text-foreground", {
									"opacity-0 w-0 overflow-hidden": state === "collapsed",
								})}
							>
								{displayVersion}
							</a>
						</HoverCardTrigger>
						<HoverCardContent side="top" align="start" className="w-fit p-3">
							<div className="flex flex-col gap-2">
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
									<span className="text-muted-foreground">Restic:</span>
									<span className="font-mono">{RESTIC_VERSION}</span>
									<span className="text-muted-foreground">Rclone:</span>
									<span className="font-mono">{RCLONE_VERSION}</span>
									<span className="text-muted-foreground">Shoutrrr:</span>
									<span className="font-mono">{SHOUTRRR_VERSION}</span>
								</div>
							</div>
						</HoverCardContent>
					</HoverCard>
					{hasUpdate && state !== "collapsed" && (
						<button
							type="button"
							onClick={() => setShowReleaseNotes(true)}
							className="text-[10px] font-medium text-destructive hover:underline cursor-pointer"
						>
							Update available
						</button>
					)}
				</div>
				<ReleaseNotesDialog open={showReleaseNotes} onOpenChange={setShowReleaseNotes} updates={updates} />
			</SidebarFooter>
		</Sidebar>
	);
}
