import { createConnectionCommand, type ConnectionPurpose } from "./connection-command";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Laptop, Plus, RefreshCw, RotateCw, Server, ShieldOff, Trash2 } from "lucide-react";
import { useState } from "react";
import {
	deleteRemoteAgentMutation,
	createRemoteAgentMutation,
	listAgentsOptions,
	revokeRemoteAgentTokenMutation,
	rotateRemoteAgentTokenMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { CreateRemoteAgentResponse, ListAgentsResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
import { Badge } from "~/client/components/ui/badge";
import { Button } from "~/client/components/ui/button";
import { Checkbox } from "~/client/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/client/components/ui/dialog";
import { Input } from "~/client/components/ui/input";
import { Label } from "~/client/components/ui/label";
import { useTimeFormat } from "~/client/lib/datetime";
import { getMachineStatus, machineStatusLabels } from "~/client/lib/machine-status";
import { cn } from "~/client/lib/utils";
import { isValidMachineName, MACHINE_NAME_MAX_LENGTH, normalizeMachineName } from "~/lib/machine-name";

type Agent = ListAgentsResponse[number];
type ConnectionCredential = CreateRemoteAgentResponse & { purpose: ConnectionPurpose };

const statusStyles = {
	online: "border-emerald-600/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	connecting: "border-sky-600/25 bg-sky-500/10 text-sky-700 dark:text-sky-400",
	degraded: "border-amber-600/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	offline: "border-border bg-muted/60 text-muted-foreground",
	revoked: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function CopyField({ label, value }: { label: string; value: string }) {
	const [copyMessage, setCopyMessage] = useState("");

	return (
		<div className="min-w-0 space-y-2">
			<p className="text-sm font-medium">{label}</p>
			<div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/35 p-2">
				<code className="min-w-0 flex-1 break-all whitespace-pre-wrap py-1 font-mono text-xs leading-relaxed">
					{value}
				</code>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-10 shrink-0 transition-transform active:scale-[0.96]"
					aria-label={`Copy ${label}`}
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(value);
							setCopyMessage(`${label} copied`);
						} catch {
							setCopyMessage(`${label} could not be copied`);
						}
					}}
				>
					<Copy aria-hidden="true" />
				</Button>
			</div>
			<p className="sr-only" aria-live="polite" aria-atomic="true">
				{copyMessage}
			</p>
		</div>
	);
}

function CredentialDialog({ credential, onClose }: { credential: ConnectionCredential | null; onClose: () => void }) {
	const [alreadyInstalled, setAlreadyInstalled] = useState(credential?.purpose === "reconnect");

	const isSecureController = credential?.controllerUrl.startsWith("wss:") ?? false;
	let connectionCommand: string | null = null;
	if (credential && isSecureController) {
		connectionCommand = createConnectionCommand(
			credential.controllerUrl,
			credential.token,
			alreadyInstalled ? "reconnect" : "connect",
		);
	}

	return (
		<Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Connect {credential?.agent.name}</DialogTitle>
					<DialogDescription>
						Run this command on the other machine to install and connect the agent. The connection code is
						single-use and expires after 15 minutes.
					</DialogDescription>
				</DialogHeader>

				<div className={cn("min-w-0 space-y-4", { hidden: !isSecureController })}>
					<p className="text-pretty text-sm text-muted-foreground">
						Requires Linux x64 or ARM64 with glibc and systemd, sudo access, and Restic 0.18.0 or newer.
					</p>
					<div className="flex items-center gap-2">
						<Checkbox
							id="agent-already-installed"
							checked={alreadyInstalled}
							onCheckedChange={(checked) => setAlreadyInstalled(checked === true)}
						/>
						<Label htmlFor="agent-already-installed">Agent already installed on this machine</Label>
					</div>
					{connectionCommand && <CopyField label="Connection command" value={connectionCommand} />}
					<p className={cn("text-pretty text-sm text-muted-foreground", { hidden: !alreadyInstalled })}>
						Reconnection replaces the credential and preserves this machine’s allowed folders.
					</p>
					<p className={cn("text-pretty text-sm text-muted-foreground", { hidden: alreadyInstalled })}>
						Choose allowed folders on the agent after installation with{" "}
						<code>sudo zerobyte-agent folders add</code>.
					</p>
				</div>
				<Alert variant="destructive" className={cn({ hidden: isSecureController })}>
					<AlertTriangle aria-hidden="true" />
					<AlertTitle>HTTPS required</AlertTitle>
					<AlertDescription>
						Serve Zerobyte over HTTPS before connecting a remote machine. Connection codes are never sent
						over plain HTTP.
					</AlertDescription>
				</Alert>

				<DialogFooter>
					<Button type="button" variant="primary" onClick={onClose}>
						Done
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function MachineRow({
	agent,
	onRotate,
	onRevoke,
	onDelete,
}: {
	agent: Agent;
	onRotate: () => void;
	onRevoke: () => void;
	onDelete: () => void;
}) {
	const { formatDateTime } = useTimeFormat();

	const status = getMachineStatus(agent);
	const isLocal = agent.kind === "local";
	const isRevoked = status === "revoked";
	const lastSeen = agent.lastSeenAt === null ? "Never" : formatDateTime(agent.lastSeenAt);
	const rootsHeading = status === "online" ? "Allowed locations" : "Allowed locations (last reported)";
	const machineDetails = [agent.capabilities.hostname, agent.capabilities.platform].filter(Boolean).join(" · ");
	const trustedRoots = agent.capabilities.trustedRoots;

	return (
		<li className="min-w-0 px-4 py-5 sm:px-5">
			<div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 space-y-3">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<Server className={cn("size-4 shrink-0", { hidden: !isLocal })} aria-hidden="true" />
						<Laptop className={cn("size-4 shrink-0", { hidden: isLocal })} aria-hidden="true" />
						<h3 className="min-w-0 break-words font-medium text-balance">{agent.name}</h3>
						<Badge variant="outline">{isLocal ? "Local" : "Remote"}</Badge>
						<Badge variant="outline" className={statusStyles[status]}>
							<span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
							{machineStatusLabels[status]}
						</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						Last seen: <span className="tabular-nums text-foreground">{lastSeen}</span>
					</p>

					<p className={cn("text-pretty text-sm text-muted-foreground", { hidden: !isLocal })}>
						This Zerobyte server.
					</p>
					<div className={cn("space-y-2 text-sm", { hidden: isLocal })}>
						<p className={cn("break-words text-muted-foreground", { hidden: !machineDetails })}>
							{machineDetails}
						</p>
						<div className={cn("space-y-2", { hidden: trustedRoots.length === 0 })}>
							<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
								{rootsHeading}
							</p>
							<ul className="flex flex-wrap gap-2" aria-label={rootsHeading}>
								{trustedRoots.map((root) => (
									<li
										key={root.id}
										className="max-w-full rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"
									>
										<span className="break-words font-medium">{root.label}</span>
										<span className="ml-2 text-muted-foreground">
											Backup {root.canBackup ? "allowed" : "blocked"}
										</span>
									</li>
								))}
							</ul>
						</div>
						<p
							className={cn("flex items-start gap-2 text-amber-700 dark:text-amber-400", {
								hidden: status !== "online" || trustedRoots.length > 0,
							})}
						>
							<AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
							Share a folder on this machine before adding sources from it.
						</p>
					</div>
				</div>

				<div
					className={cn("flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:justify-end", {
						hidden: isLocal,
					})}
				>
					<Button
						type="button"
						variant="outline"
						onClick={onRotate}
						aria-label={`${isRevoked ? "Issue new credential for" : "Rotate credential for"} ${agent.name}`}
					>
						<RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
						{isRevoked ? "Issue new credential" : "Rotate credential"}
					</Button>
					<Button
						type="button"
						variant="outline"
						className={cn({ hidden: isRevoked })}
						onClick={onRevoke}
						aria-label={`Revoke ${agent.name}`}
					>
						<ShieldOff className="mr-2 h-4 w-4" aria-hidden="true" />
						Revoke
					</Button>
					<Button type="button" variant="destructive" onClick={onDelete} aria-label={`Delete ${agent.name}`}>
						<Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
						Delete
					</Button>
				</div>
			</div>
		</li>
	);
}

export function MachinesSection() {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [machineName, setMachineName] = useState("");
	const [credential, setCredential] = useState<ConnectionCredential | null>(null);
	const [rotationTarget, setRotationTarget] = useState<Agent | null>(null);
	const [deletionTarget, setDeletionTarget] = useState<Agent | null>(null);
	const [revocationTarget, setRevocationTarget] = useState<Agent | null>(null);

	const agentsQuery = useSuspenseQuery({
		...listAgentsOptions(),
		refetchInterval: 5_000,
		refetchIntervalInBackground: false,
	});

	const agents = agentsQuery.data;
	const remoteCount = agents.filter((agent) => agent.kind === "remote").length;

	const machineNameIsValid = isValidMachineName(machineName);
	const machineNameHasError = machineName.length > 0 && !machineNameIsValid;

	let machineNameDescription = "remote-machine-name-hint";
	if (machineNameHasError) machineNameDescription += " remote-machine-name-error";

	const createAgent = useMutation({
		...createRemoteAgentMutation(),
		onSuccess: (result) => {
			setCreateDialogOpen(false);
			setMachineName("");
			setCredential({ ...result, purpose: "connect" });
		},
	});

	const rotateCredential = useMutation({
		...rotateRemoteAgentTokenMutation(),
		onSuccess: (result) => {
			const agent = result.agent;
			let purpose: ConnectionPurpose = "connect";
			if (agent.lastSeenAt !== null || agent.lastReadyAt !== null || agent.capabilities.hostname !== null) {
				purpose = "reconnect";
			}

			setRotationTarget(null);
			setCredential({ ...result, purpose });
		},
	});

	const deleteMachine = useMutation({
		...deleteRemoteAgentMutation(),
		onSuccess: () => setDeletionTarget(null),
	});

	const revokeCredential = useMutation({
		...revokeRemoteAgentTokenMutation(),
		onSuccess: () => setRevocationTarget(null),
	});

	const closeCreateDialog = () => {
		setCreateDialogOpen(false);
		setMachineName("");
		createAgent.reset();
	};

	const closeCredential = () => {
		setCredential(null);
		createAgent.reset();
		rotateCredential.reset();
	};

	const handleCreate = (event: React.SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!machineNameIsValid) return;

		createAgent.mutate({ body: { name: normalizeMachineName(machineName) } });
	};

	return (
		<>
			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1">
						<p className={cn("text-sm font-medium", { hidden: remoteCount > 0 })}>No remote machines</p>
						<p className={cn("text-sm font-medium", { hidden: remoteCount === 0 })}>
							{remoteCount} remote machine{remoteCount === 1 ? "" : "s"}
						</p>
						<p className="text-pretty text-xs text-muted-foreground">
							The local server remains available automatically.
						</p>
					</div>
					<Button
						type="button"
						variant="primary"
						className="w-full sm:w-auto"
						onClick={() => setCreateDialogOpen(true)}
					>
						<Plus className="mr-2 h-4 w-4" aria-hidden="true" />
						Connect machine
					</Button>
				</div>

				{agentsQuery.isError && (
					<Alert variant="destructive">
						<AlertTriangle aria-hidden="true" />
						<AlertTitle>Machines could not be loaded</AlertTitle>
						<AlertDescription className="space-y-3">
							<p>Check the connection and try again.</p>
							<Button
								type="button"
								variant="outline"
								onClick={() => void agentsQuery.refetch()}
								loading={agentsQuery.isFetching}
							>
								<RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
								Retry
							</Button>
						</AlertDescription>
					</Alert>
				)}

				<ul className="min-w-0 divide-y overflow-hidden rounded-lg border" aria-label="Machines">
					{agents.map((agent) => (
						<MachineRow
							key={agent.id}
							agent={agent}
							onRotate={() => {
								rotateCredential.reset();
								setRotationTarget(agent);
							}}
							onRevoke={() => {
								revokeCredential.reset();
								setRevocationTarget(agent);
							}}
							onDelete={() => {
								deleteMachine.reset();
								setDeletionTarget(agent);
							}}
						/>
					))}
				</ul>
			</div>

			<Dialog
				open={createDialogOpen}
				onOpenChange={(open) => (open ? setCreateDialogOpen(true) : closeCreateDialog())}
			>
				<DialogContent>
					<form onSubmit={handleCreate} className="space-y-5">
						<DialogHeader>
							<DialogTitle>Connect a remote machine</DialogTitle>
							<DialogDescription>Name the machine to connect it to Zerobyte.</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Label htmlFor="remote-machine-name">Machine name</Label>
							<Input
								id="remote-machine-name"
								value={machineName}
								onChange={(event) => setMachineName(event.target.value)}
								maxLength={MACHINE_NAME_MAX_LENGTH}
								aria-invalid={machineNameHasError}
								aria-describedby={machineNameDescription}
								required
							/>
							<p id="remote-machine-name-hint" className="text-pretty text-xs text-muted-foreground">
								Use a recognizable name such as the host or site.
							</p>
							{machineNameHasError && (
								<p
									id="remote-machine-name-error"
									role="alert"
									className="text-pretty text-sm text-destructive"
								>
									Enter a non-empty machine name without invisible control or formatting characters.
								</p>
							)}
						</div>
						{createAgent.isError && (
							<p role="alert" className="text-sm text-destructive">
								The credential could not be issued. Check the name and try again.
							</p>
						)}
						<DialogFooter>
							<Button type="button" variant="outline" onClick={closeCreateDialog}>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="primary"
								loading={createAgent.isPending}
								disabled={!machineNameIsValid}
							>
								Issue credential
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<CredentialDialog key={credential?.token} credential={credential} onClose={closeCredential} />

			<AlertDialog open={rotationTarget !== null} onOpenChange={(open) => !open && setRotationTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<span className={cn({ hidden: rotationTarget?.revokedAt == null })}>
								Issue new credential
							</span>
							<span className={cn({ hidden: rotationTarget?.revokedAt != null })}>Rotate credential</span>
						</AlertDialogTitle>
						<AlertDialogDescription>
							{rotationTarget?.name} will disconnect immediately. Its old credential will stop working,
							and the replacement credential will be shown only once.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{rotateCredential.isError && (
						<p role="alert" className="text-sm text-destructive">
							The credential could not be issued. Nothing was shown; you can try again.
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={rotateCredential.isPending}>Cancel</AlertDialogCancel>
						<Button
							variant="primary"
							loading={rotateCredential.isPending}
							onClick={() =>
								rotationTarget && rotateCredential.mutate({ path: { agentId: rotationTarget.id } })
							}
						>
							Issue new credential
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={revocationTarget !== null} onOpenChange={(open) => !open && setRevocationTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke {revocationTarget?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This machine will disconnect and its credential will stop working immediately. Existing
							sources are kept, and you can issue a new credential later.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{revokeCredential.isError && (
						<p role="alert" className="text-sm text-destructive">
							The machine could not be revoked. It may still be connected; try again.
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={revokeCredential.isPending}>Cancel</AlertDialogCancel>
						<Button
							variant="destructive"
							loading={revokeCredential.isPending}
							onClick={() =>
								revocationTarget && revokeCredential.mutate({ path: { agentId: revocationTarget.id } })
							}
						>
							Revoke
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={deletionTarget !== null} onOpenChange={(open) => !open && setDeletionTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {deletionTarget?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							This machine will disconnect and be removed. Delete its sources first.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteMachine.isError && (
						<p role="alert" className="text-sm text-destructive">
							{deleteMachine.error.message}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<Button
							variant="destructive"
							loading={deleteMachine.isPending}
							onClick={() =>
								deletionTarget && deleteMachine.mutate({ path: { agentId: deletionTarget.id } })
							}
						>
							Delete machine
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
