import { AlertTriangle, ChevronDown, Laptop, RotateCw, Server, ShieldOff, Trash2 } from "lucide-react";
import { useRef } from "react";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/client/components/ui/dropdown-menu";
import { useTimeFormat } from "~/client/lib/datetime";
import { getMachineDisplayName } from "~/lib/machine-name";
import { connectionPurpose, getEffectiveMachineStatus } from "./machine-presentation";

type Agent = ListAgentsResponse[number];

const statusStyles = {
	online: "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	connecting: "border-sky-600/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
	degraded: "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	offline: "border-border bg-muted/60 text-muted-foreground",
	revoked: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

const statusLabels = {
	online: "Online",
	connecting: "Connecting",
	degraded: "Degraded",
	offline: "Offline",
	revoked: "Revoked",
} as const;

export function MachineRow({
	agent,
	onRotate,
	onRevoke,
	onDelete,
}: {
	agent: Agent;
	onRotate: (agent: Agent, trigger: HTMLButtonElement) => void;
	onRevoke: (agent: Agent, trigger: HTMLButtonElement) => void;
	onDelete: (agent: Agent, trigger: HTMLButtonElement) => void;
}) {
	const actionsTriggerRef = useRef<HTMLButtonElement>(null);
	const openingDialogRef = useRef(false);

	const { formatDateTime } = useTimeFormat();

	const presentation = agent.capabilities;
	const status = getEffectiveMachineStatus(agent);
	const statusLabel = statusLabels[status];
	const isLocal = agent.kind === "local";
	const isRevoked = status === "revoked";
	const lastSeen = agent.lastSeenAt === null ? "Never" : formatDateTime(agent.lastSeenAt);
	const rootsPrefix = status === "online" ? "Allowed locations" : "Allowed locations (last reported)";
	const machineDetails = [presentation.hostname, presentation.platform].filter(Boolean).join(" · ");
	const machineDisplayName = getMachineDisplayName(agent.name);

	const openAction = (action: (agent: Agent, trigger: HTMLButtonElement) => void) => {
		if (!actionsTriggerRef.current) return;
		openingDialogRef.current = true;
		action(agent, actionsTriggerRef.current);
	};

	return (
		<li className="min-w-0 px-4 py-5 sm:px-5">
			<div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 space-y-3">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						{isLocal ? (
							<Server className="size-4 shrink-0" aria-hidden="true" />
						) : (
							<Laptop className="size-4 shrink-0" aria-hidden="true" />
						)}
						<h3 className="min-w-0 max-w-full [overflow-wrap:anywhere] font-medium text-balance">
							{machineDisplayName}
						</h3>
						<Badge variant="outline">{isLocal ? "Local" : "Remote"}</Badge>
						<Badge variant="outline" className={statusStyles[status]}>
							<span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
							{statusLabel}
						</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						Last seen: <span className="tabular-nums text-foreground">{lastSeen}</span>
					</p>

					{isLocal ? (
						<p className="text-pretty text-sm text-muted-foreground">This Zerobyte server.</p>
					) : (
						<div className="space-y-2 text-sm">
							{machineDetails && <p className="break-words text-muted-foreground">{machineDetails}</p>}
							{presentation.trustedRoots.length > 0 && (
								<div className="space-y-2">
									<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
										{rootsPrefix}
									</p>
									<ul className="flex flex-wrap gap-2" aria-label={rootsPrefix}>
										{presentation.trustedRoots.map((root, index) => {
											const rootKey = `${root.label}-${index}`;
											return (
												<li
													key={rootKey}
													className="max-w-full rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"
												>
													<span className="break-words font-medium">{root.label}</span>
													<span className="ml-2 text-muted-foreground">
														Backup {root.canBackup ? "allowed" : "blocked"}
													</span>
												</li>
											);
										})}
									</ul>
								</div>
							)}
							{status === "online" && presentation.trustedRoots.length === 0 && (
								<p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
									<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
									<span>
										Choose Allowed locations on this machine with{" "}
										<code>sudo zerobyte-agent folders add</code>, then create a Source.
									</span>
								</p>
							)}
						</div>
					)}
				</div>

				{!isLocal && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								ref={actionsTriggerRef}
								type="button"
								variant="outline"
								className="self-start shrink-0"
								aria-label={`Actions for ${machineDisplayName}`}
							>
								Actions <ChevronDown aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							onCloseAutoFocus={(event) => {
								if (openingDialogRef.current) event.preventDefault();
								openingDialogRef.current = false;
							}}
						>
							<DropdownMenuItem onSelect={() => openAction(onRotate)}>
								<RotateCw aria-hidden="true" />
								{connectionPurpose(agent) === "reconnect"
									? "Reconnect machine"
									: "Get connection command"}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							{!isRevoked && (
								<DropdownMenuItem variant="destructive" onSelect={() => openAction(onRevoke)}>
									<ShieldOff aria-hidden="true" />
									Revoke connection
								</DropdownMenuItem>
							)}
							<DropdownMenuItem variant="destructive" onSelect={() => openAction(onDelete)}>
								<Trash2 aria-hidden="true" />
								Delete machine
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</li>
	);
}
