import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeft,
	Bell,
	Building2,
	CalendarClock,
	Database,
	HardDrive,
	ListChecks,
	RefreshCw,
	Server,
	Settings,
	User,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "~/client/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "~/client/components/ui/hover-card";
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
import { usePermissions } from "~/client/hooks/use-permissions";
import { useSystemInfo } from "~/client/hooks/use-system-info";
import { useUpdates } from "~/client/hooks/use-updates";
import {
	getActiveSettingsScope,
	getSettingsScopeAvailability,
	getVisibleSettingsScopeNavigationItems,
	type SettingsScope,
} from "~/client/modules/settings/settings-scope";
import { cn } from "~/client/lib/utils";
import { APP_VERSION, RCLONE_VERSION, RESTIC_VERSION, SHOUTRRR_VERSION } from "~/client/lib/version";
import { OrganizationSwitcher } from "./organization-switcher";
import { ReleaseNotesDialog } from "./release-notes-dialog";

const items = [
	{ title: "Volumes", url: "/volumes", icon: HardDrive },
	{ title: "Repositories", url: "/repositories", icon: Database },
	{ title: "Backups", url: "/backups", icon: CalendarClock },
	{ title: "Notifications", url: "/notifications", icon: Bell },
	{ title: "Activity", url: "/activity", icon: ListChecks },
] as const;

const settingsScopeIcons: Record<SettingsScope, typeof User> = {
	personal: User,
	organization: Building2,
	instance: Server,
};

const footerActionClassName =
	"relative flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50";
const activeFooterActionClassName = "bg-strong-accent/10 text-strong-accent";
const sidebarPanelClassName = "absolute inset-0 flex min-h-0 flex-col bg-sidebar";

export function AppSidebar() {
	const navigate = useNavigate();
	const { state, open, setOpen, isMobile, setOpenMobile } = useSidebar();
	const { updates, hasUpdate, isFetching, error: updatesError, checkForUpdates } = useUpdates();
	const { runtime } = useSystemInfo();
	const permissions = usePermissions();
	const [showReleaseNotes, setShowReleaseNotes] = useState(false);
	const openBeforeSettingsRef = useRef<boolean | null>(null);
	const settingsReturnLocationRef = useRef("/volumes");

	const location = useRouterState({ select: (routerState) => routerState.location });
	const isSettingsMode = location.pathname === "/settings" || location.pathname.startsWith("/settings/");
	const isCollapsed = state === "collapsed";
	const isDesktopRuntime = runtime === "desktop";
	const footerOverlaySide = isCollapsed ? "right" : "top";

	const scopeAvailability = getSettingsScopeAvailability(permissions);
	const activeSettingsScope = getActiveSettingsScope(location.search, scopeAvailability);
	const visibleSettingsItems = getVisibleSettingsScopeNavigationItems(scopeAvailability);

	const displayVersion = APP_VERSION.startsWith("v") || APP_VERSION === "dev" ? APP_VERSION : `v${APP_VERSION}`;
	const releaseUrl =
		APP_VERSION === "dev"
			? "https://github.com/nicotsx/zerobyte"
			: `https://github.com/nicotsx/zerobyte/releases/tag/${displayVersion}`;
	const availableVersion = updates?.latestVersion ?? "New version";
	const versionStatus = hasUpdate ? `${availableVersion} available` : "Up to date";
	const versionCheckStatus = updatesError ? "Last check failed" : versionStatus;
	const versionCheckLabel = `Check for updates. ${versionCheckStatus}. Current version ${displayVersion}.`;

	useEffect(() => {
		if (isMobile) {
			return;
		}

		if (isSettingsMode) {
			if (openBeforeSettingsRef.current === null) {
				openBeforeSettingsRef.current = open;
			}
			if (!open) {
				setOpen(true);
			}
			return;
		}

		const openBeforeSettings = openBeforeSettingsRef.current;
		openBeforeSettingsRef.current = null;
		if (openBeforeSettings === false && open) {
			setOpen(false);
		}
	}, [isMobile, isSettingsMode, open, setOpen]);

	const closeMobileSidebar = () => {
		if (isMobile) {
			setOpenMobile(false);
		}
	};

	const rememberSettingsReturnLocation = () => {
		const { pathname, search, hash } = window.location;
		const returnLocation = `${pathname}${search}${hash}`;
		settingsReturnLocationRef.current = returnLocation;
	};

	const handleSettingsBack = () => {
		const returnLocation = settingsReturnLocationRef.current;
		void navigate({ href: returnLocation, replace: true });
	};

	const handleVersionCheck = async () => {
		if (hasUpdate) {
			setShowReleaseNotes(true);
			return;
		}

		const result = await checkForUpdates();
		if (result.error) {
			toast.error("Failed to check for updates");
			return;
		}

		if (result.data?.hasUpdate) {
			setShowReleaseNotes(true);
			return;
		}

		toast.success("Zerobyte is up to date", { description: `You're running ${displayVersion}.` });
	};

	const mainPanelInert = isSettingsMode;
	const settingsPanelInert = !isSettingsMode;
	const settingsPanelPosition = isSettingsMode ? "translate-x-0" : "translate-x-full";
	const versionButton = (
		<button
			type="button"
			onClick={handleVersionCheck}
			className={cn(footerActionClassName, {
				"text-destructive hover:text-destructive": hasUpdate,
			})}
			disabled={isFetching}
			aria-label={versionCheckLabel}
		>
			<RefreshCw className={cn("size-4", { "animate-spin": isFetching })} />
			{hasUpdate && (
				<span aria-hidden="true" className="absolute top-2 right-2 size-1.5 rounded-full bg-destructive" />
			)}
		</button>
	);

	return (
		<Sidebar variant="inset" collapsible="icon" className="p-0">
			<div className="relative min-h-0 flex-1 overflow-hidden">
				<div className={sidebarPanelClassName} aria-hidden={isSettingsMode} inert={mainPanelInert}>
					<MainSidebarHeader isCollapsed={isCollapsed} isDesktopRuntime={isDesktopRuntime} />
					<SidebarContent className="p-2 border-r">
						<SidebarGroup>
							<SidebarGroupContent>
								<SidebarMenu>
									{items.map((item) => (
										<SidebarNavigationItem
											key={item.title}
											title={item.title}
											isCollapsed={isCollapsed}
										>
											<Link
												to={item.url}
												onClick={closeMobileSidebar}
												activeProps={{ className: "bg-strong-accent/10" }}
												className="w-full flex items-center gap-2"
											>
												{({ isActive }) => (
													<SidebarItemContent
														active={isActive}
														isCollapsed={isCollapsed}
														icon={item.icon}
														label={item.title}
													/>
												)}
											</Link>
										</SidebarNavigationItem>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter className="border-t border-r border-border/80 p-2 dark:border-border/50">
						<OrganizationSwitcher />
						<div className="flex w-full items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col">
							<Tooltip>
								<TooltipTrigger asChild>
									<Link
										to="/settings"
										search={{ scope: "personal" }}
										onClick={rememberSettingsReturnLocation}
										className={footerActionClassName}
										activeProps={{ className: activeFooterActionClassName }}
										aria-label="Settings"
									>
										<Settings className="size-4" />
									</Link>
								</TooltipTrigger>
								<TooltipContent side={footerOverlaySide}>Settings</TooltipContent>
							</Tooltip>
							{isMobile ? (
								versionButton
							) : (
								<HoverCard openDelay={200}>
									<HoverCardTrigger asChild>{versionButton}</HoverCardTrigger>
									<HoverCardContent side={footerOverlaySide} align="end" className="w-fit p-3">
										<div className="flex flex-col gap-2">
											<div className="flex items-center justify-between gap-6 text-xs">
												<a
													href={releaseUrl}
													target="_blank"
													rel="noopener noreferrer"
													className="font-medium hover:underline"
												>
													Zerobyte {displayVersion}
												</a>
												<span
													className={cn("text-muted-foreground", {
														"text-destructive": hasUpdate,
													})}
												>
													{versionCheckStatus}
												</span>
											</div>
											<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t pt-2 text-[11px]">
												<span className="text-muted-foreground">Restic:</span>
												<span className="font-mono">{RESTIC_VERSION}</span>
												<span className="text-muted-foreground">Rclone:</span>
												<span className="font-mono">{RCLONE_VERSION}</span>
												<span className="text-muted-foreground">Shoutrrr:</span>
												<span className="font-mono">{SHOUTRRR_VERSION}</span>
											</div>
											<span className="text-[10px] text-muted-foreground">
												{hasUpdate ? "Open release notes" : "Click to check for updates"}
											</span>
										</div>
									</HoverCardContent>
								</HoverCard>
							)}
						</div>
					</SidebarFooter>
				</div>

				<div
					className={cn(
						sidebarPanelClassName,
						"z-10 shadow-[-12px_0_24px_-20px_rgba(0,0,0,0.55)] transition-transform duration-200 ease-out motion-reduce:transition-none",
						settingsPanelPosition,
					)}
					aria-hidden={!isSettingsMode}
					inert={settingsPanelInert}
				>
					<SidebarHeader className="h-16.25 shrink-0 justify-center border-b border-border/80 px-4 dark:border-border/50">
						<div className="flex items-center gap-2 font-semibold">
							<Settings className="size-4 shrink-0 text-strong-accent" />
							<span className="group-data-[collapsible=icon]:hidden">Settings</span>
						</div>
					</SidebarHeader>
					<SidebarContent className="border-r p-2">
						<SidebarGroup>
							<SidebarGroupContent>
								<SidebarMenu>
									{visibleSettingsItems.map((item) => {
										const isActive = activeSettingsScope === item.scope;
										const icon = settingsScopeIcons[item.scope];

										return (
											<SidebarNavigationItem
												key={item.title}
												title={item.title}
												isCollapsed={isCollapsed}
											>
												<Link
													to="/settings"
													search={{ scope: item.scope }}
													replace
													onClick={closeMobileSidebar}
													className={cn("w-full flex items-center gap-2", {
														"bg-strong-accent/10": isActive,
													})}
												>
													<SidebarItemContent
														active={isActive}
														isCollapsed={isCollapsed}
														icon={icon}
														label={item.title}
													/>
												</Link>
											</SidebarNavigationItem>
										);
									})}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					</SidebarContent>
					<SidebarFooter className="border-t border-r border-border/80 p-2 dark:border-border/50">
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton asChild className="h-10" tooltip="Back">
									<button type="button" onClick={handleSettingsBack}>
										<ArrowLeft className="size-4" />
										<span>Back</span>
									</button>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarFooter>
				</div>
			</div>
			<ReleaseNotesDialog open={showReleaseNotes} onOpenChange={setShowReleaseNotes} updates={updates} />
		</Sidebar>
	);
}

function MainSidebarHeader({ isCollapsed, isDesktopRuntime }: { isCollapsed: boolean; isDesktopRuntime: boolean }) {
	return (
		<SidebarHeader className="bg-card-header border-b border-border/80 dark:border-border/50 hidden md:flex h-16.25 shrink-0 flex-row items-center p-4">
			<Link to="/volumes" className="flex items-center gap-3 font-semibold pl-2">
				<img src="/images/zerobyte.png" alt="Zerobyte Logo" className="h-8 w-8 shrink-0 object-contain -ml-2" />
				<span
					className={cn("text-base transition-[opacity,width] duration-200 -ml-1", {
						"opacity-0 w-0 overflow-hidden": isCollapsed,
					})}
				>
					Zerobyte
				</span>
				<Badge
					variant="secondary"
					className={cn("h-5 px-1.5 text-[10px] font-semibold", {
						hidden: !isDesktopRuntime || isCollapsed,
					})}
				>
					Alpha
				</Badge>
			</Link>
		</SidebarHeader>
	);
}

function SidebarItemContent({
	active,
	isCollapsed,
	icon: Icon,
	label,
}: {
	active: boolean;
	isCollapsed: boolean;
	icon: typeof User;
	label: string;
}) {
	return (
		<>
			{active && (
				<div
					className={cn("absolute left-0 top-0 h-full w-0.75 bg-strong-accent mr-2", {
						hidden: isCollapsed,
					})}
				/>
			)}
			<Icon
				className={cn("transition-[color,margin] duration-200", {
					"text-strong-accent": active,
					"ml-1": active && !isCollapsed,
					"text-muted-foreground": !active,
				})}
			/>
			<span
				className={cn({
					"text-foreground font-medium": active,
					"text-muted-foreground": !active,
				})}
			>
				{label}
			</span>
		</>
	);
}

function SidebarNavigationItem({
	title,
	isCollapsed,
	children,
}: {
	title: string;
	isCollapsed: boolean;
	children: ReactNode;
}) {
	return (
		<SidebarMenuItem>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<SidebarMenuButton asChild className="relative overflow-hidden">
							{children}
						</SidebarMenuButton>
					</TooltipTrigger>
					<TooltipContent side="right" className={cn({ hidden: !isCollapsed })}>
						<p>{title}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</SidebarMenuItem>
	);
}
