import { createConnectionCommand } from "./connection-command";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Copy, Laptop, Plus, RefreshCw, RotateCw, Server, ShieldOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import {
	deleteRemoteAgentMutation,
	createRemoteAgentMutation,
	listAgentsOptions,
	revokeRemoteAgentTokenMutation,
	rotateRemoteAgentTokenMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
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
import { Skeleton } from "~/client/components/ui/skeleton";
import { useTimeFormat } from "~/client/lib/datetime";
import {
	getMachineDisplayName,
	isValidMachineName,
	MACHINE_NAME_MAX_LENGTH,
	normalizeMachineName,
} from "~/lib/machine-name";
import { getEffectiveMachineStatus } from "./machine-presentation";

type Agent = ListAgentsResponse[number];
type CredentialPresentation = {
	machineName: string;
	controllerUrl: string;
	token: string;
	expiresAt: number;
};
type ClipboardField = "connection command";

const createCredentialMutationKey = ["remote-agent-credential", "create"] as const;
const rotateCredentialMutationKey = ["remote-agent-credential", "rotate"] as const;

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

function CopyField({
	label,
	value,
	onClipboardResult,
}: {
	label: ClipboardField;
	value: string;
	onClipboardResult: (message: string) => void;
}) {
	const accessibleName = `Copy ${label}`;
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
					aria-label={accessibleName}
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(value);
							onClipboardResult(`${label} copied`);
						} catch {
							onClipboardResult(`${label} could not be copied`);
						}
					}}
				>
					<Copy aria-hidden="true" />
				</Button>
			</div>
		</div>
	);
}

function CredentialDialog({
	presentation,
	onClose,
	returnFocus,
}: {
	presentation: CredentialPresentation | null;
	onClose: () => void;
	returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
	const [clipboardMessage, setClipboardMessage] = useState("");
	const isOpen = presentation !== null;
	const token = presentation?.token ?? "";
	const controllerUrl = presentation?.controllerUrl ?? "";
	const connectionCommand = /^wss?:/.test(controllerUrl) ? createConnectionCommand(controllerUrl, token) : "";
	const hasController = /^wss?:/.test(controllerUrl);

	const handleOpenChange = (open: boolean) => {
		if (open) return;
		setClipboardMessage("");
		onClose();
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle>Credential for {presentation?.machineName}</DialogTitle>
					<DialogDescription>
						Run this command on the other machine. The connection code is single-use and expires after 15
						minutes.
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4">
					{hasController && (
						<CopyField
							label="connection command"
							value={connectionCommand}
							onClipboardResult={setClipboardMessage}
						/>
					)}
				</div>

				<p className="sr-only" aria-live="polite" aria-atomic="true">
					{clipboardMessage}
				</p>
				<DialogFooter>
					<Button type="button" variant="primary" onClick={() => handleOpenChange(false)}>
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
	onRotate: (agent: Agent, trigger: HTMLButtonElement) => void;
	onRevoke: (agent: Agent, trigger: HTMLButtonElement) => void;
	onDelete: (agent: Agent) => void;
}) {
	const { formatDateTime } = useTimeFormat();
	const presentation = agent.capabilities;
	const status = getEffectiveMachineStatus(agent);
	const statusLabel = statusLabels[status];
	const isLocal = agent.kind === "local";
	const isRevoked = status === "revoked";
	const lastSeen = agent.lastSeenAt === null ? "Never" : formatDateTime(agent.lastSeenAt);
	const rootsPrefix = status === "online" ? "Trusted locations" : "Trusted locations (last reported)";
	const machineDetails = [presentation.hostname, presentation.platform].filter(Boolean).join(" · ");
	const machineDisplayName = getMachineDisplayName(agent.name);

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
						<h3 className="min-w-0 break-words font-medium text-balance">{machineDisplayName}</h3>
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
									Choose folders on this machine with <code>sudo zerobyte-agent folders add</code>.
								</p>
							)}
						</div>
					)}
				</div>

				{!isLocal && (
					<div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row lg:justify-end">
						<Button
							type="button"
							variant="outline"
							className="w-full sm:w-auto"
							onClick={(event) => onRotate(agent, event.currentTarget)}
							aria-label={`${isRevoked ? "Issue new credential for" : "Rotate credential for"} ${machineDisplayName}`}
						>
							<RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
							{isRevoked ? "Issue new credential" : "Rotate credential"}
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => onDelete(agent)}
							aria-label={`Delete ${machineDisplayName}`}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</Button>
						{!isRevoked && (
							<Button
								type="button"
								variant="destructive"
								className="w-full sm:w-auto"
								onClick={(event) => onRevoke(agent, event.currentTarget)}
								aria-label={`Revoke ${machineDisplayName}`}
							>
								<ShieldOff className="mr-2 h-4 w-4" aria-hidden="true" />
								Revoke
							</Button>
						)}
					</div>
				)}
			</div>
		</li>
	);
}

export function MachinesSection({ controllerUrl }: { controllerUrl: string }) {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [machineName, setMachineName] = useState("");
	const [credentialPresentation, setCredentialPresentation] = useState<CredentialPresentation | null>(null);
	const [rotationTarget, setRotationTarget] = useState<Agent | null>(null);
	const [deletionTarget, setDeletionTarget] = useState<Agent | null>(null);
	const [revocationTarget, setRevocationTarget] = useState<Agent | null>(null);

	const agentsQuery = useQuery({
		...listAgentsOptions(),
		refetchInterval: 5_000,
		refetchIntervalInBackground: false,
	});

	const agents = agentsQuery.data ?? [];

	const remoteAgents = agents.filter((agent) => agent.kind === "remote");
	const remoteCount = remoteAgents.length;
	const remoteMachineLabel =
		remoteCount === 0 ? "No remote machines" : `${remoteCount} remote machine${remoteCount === 1 ? "" : "s"}`;

	const normalizedMachineName = normalizeMachineName(machineName);

	const machineNameIsValid = isValidMachineName(machineName);
	const machineNameHasError = machineName.length > 0 && !machineNameIsValid;
	const machineNameHintId = "remote-machine-name-hint";
	const machineNameErrorId = "remote-machine-name-error";

	const machineNameDescriptionIds = machineNameHasError
		? `${machineNameHintId} ${machineNameErrorId}`
		: machineNameHintId;

	const connectTriggerRef = useRef<HTMLButtonElement>(null);
	const machineNameInputRef = useRef<HTMLInputElement>(null);
	const rotationTriggerRef = useRef<HTMLButtonElement>(null);
	const revocationTriggerRef = useRef<HTMLButtonElement>(null);
	const credentialReturnFocusRef = useRef<HTMLButtonElement>(null);

	const queryClient = useQueryClient();

	const createAgent = useMutation({
		...createRemoteAgentMutation(),
		gcTime: 0,
		mutationKey: createCredentialMutationKey,
		onSuccess: (result) => {
			const enrollmentControllerUrl = result.controllerUrl;

			credentialReturnFocusRef.current = connectTriggerRef.current;
			setCreateDialogOpen(false);
			setMachineName("");
			setCredentialPresentation({
				machineName: getMachineDisplayName(result.agent.name),
				controllerUrl: enrollmentControllerUrl,
				token: result.token,
				expiresAt: result.expiresAt,
			});
		},
	});

	const rotateCredential = useMutation({
		...rotateRemoteAgentTokenMutation(),
		gcTime: 0,
		mutationKey: rotateCredentialMutationKey,
		onSuccess: (result) => {
			credentialReturnFocusRef.current = rotationTriggerRef.current;
			setRotationTarget(null);
			setCredentialPresentation({
				machineName: getMachineDisplayName(result.agent.name),
				controllerUrl,
				token: result.token,
				expiresAt: result.expiresAt,
			});
		},
	});

	const deleteMachine = useMutation({ ...deleteRemoteAgentMutation(), onSuccess: () => setDeletionTarget(null) });

	const revokeCredential = useMutation({
		...revokeRemoteAgentTokenMutation(),
		onSuccess: () => {
			setRevocationTarget(null);
		},
	});

	const closeCreateDialog = () => {
		setCreateDialogOpen(false);
		setMachineName("");
		createAgent.reset();
	};

	const handleCreate = (event: React.SubmitEvent<HTMLFormElement>) => {
		event.preventDefault();
		const name = normalizedMachineName;

		if (!machineNameIsValid) return;
		createAgent.mutate({ body: { name } });
	};

	const handleRotate = () => {
		const target = rotationTarget;

		if (!target) return;
		rotateCredential.mutate({ path: { agentId: target.id } });
	};

	const selectRotationTarget = (agent: Agent, trigger: HTMLButtonElement) => {
		rotateCredential.reset();
		rotationTriggerRef.current = trigger;
		setRotationTarget(agent);
	};

	const handleRevoke = () => {
		const target = revocationTarget;

		if (!target) return;
		revokeCredential.mutate({ path: { agentId: target.id } });
	};

	const selectRevocationTarget = (agent: Agent, trigger: HTMLButtonElement) => {
		revokeCredential.reset();
		revocationTriggerRef.current = trigger;
		setRevocationTarget(agent);
	};

	const rotationStatus = rotationTarget ? getEffectiveMachineStatus(rotationTarget) : null;
	const rotationTitle = rotationStatus === "revoked" ? "Issue new credential" : "Rotate credential";
	const rotationTargetName = rotationTarget ? getMachineDisplayName(rotationTarget.name) : "";
	const revocationTargetName = revocationTarget ? getMachineDisplayName(revocationTarget.name) : "";

	const removeCredentialMutations = () => {
		createAgent.reset();
		rotateCredential.reset();

		const mutationCache = queryClient.getMutationCache();
		const createMutations = mutationCache.findAll({ mutationKey: createCredentialMutationKey });
		const rotateMutations = mutationCache.findAll({ mutationKey: rotateCredentialMutationKey });
		const credentialMutations = [...createMutations, ...rotateMutations];

		for (const mutation of credentialMutations) mutationCache.remove(mutation);
	};

	const closeCredentialPresentation = () => {
		setCredentialPresentation(null);
		removeCredentialMutations();
	};

	return (
		<>
			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1">
						<p className="text-sm font-medium">{remoteMachineLabel}</p>
						<p className="text-pretty text-xs text-muted-foreground">
							The local server remains available automatically.
						</p>
					</div>
					<Button
						ref={connectTriggerRef}
						type="button"
						variant="primary"
						className="w-full sm:w-auto"
						onClick={() => setCreateDialogOpen(true)}
					>
						<Plus className="mr-2 h-4 w-4" aria-hidden="true" />
						Connect machine
					</Button>
				</div>

				{agentsQuery.isPending && (
					<div aria-label="Loading machines" className="space-y-3 rounded-lg border p-4">
						<Skeleton className="h-5 w-48" />
						<Skeleton className="h-4 w-full max-w-md" />
						<Skeleton className="h-9 w-40" />
					</div>
				)}

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

				{agentsQuery.isSuccess && (
					<ul className="min-w-0 divide-y overflow-hidden rounded-lg border" aria-label="Machines">
						{agents.map((agent) => (
							<MachineRow
								key={agent.id}
								agent={agent}
								onRotate={selectRotationTarget}
								onRevoke={selectRevocationTarget}
								onDelete={(agent) => {
									deleteMachine.reset();
									setDeletionTarget(agent);
								}}
							/>
						))}
					</ul>
				)}
			</div>

			<AlertDialog
				open={!!deletionTarget}
				onOpenChange={(open) => {
					if (!open) setDeletionTarget(null);
				}}
			>
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
							onClick={() => {
								if (deletionTarget) deleteMachine.mutate({ path: { agentId: deletionTarget.id } });
							}}
						>
							Delete machine
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog
				open={createDialogOpen}
				onOpenChange={(open) => (open ? setCreateDialogOpen(true) : closeCreateDialog())}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						machineNameInputRef.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						connectTriggerRef.current?.focus();
					}}
				>
					<form onSubmit={handleCreate} className="space-y-5">
						<DialogHeader>
							<DialogTitle>Connect a remote machine</DialogTitle>
							<DialogDescription>Name the machine to connect it to Zerobyte.</DialogDescription>
						</DialogHeader>
						<div className="space-y-2">
							<Label htmlFor="remote-machine-name">Machine name</Label>
							<Input
								ref={machineNameInputRef}
								id="remote-machine-name"
								value={machineName}
								onChange={(event) => setMachineName(event.target.value)}
								maxLength={MACHINE_NAME_MAX_LENGTH}
								aria-invalid={machineNameHasError}
								aria-describedby={machineNameDescriptionIds}
								required
							/>
							<p id={machineNameHintId} className="text-pretty text-xs text-muted-foreground">
								Use a recognizable name such as the host or site.
							</p>
							{machineNameHasError && (
								<p
									id={machineNameErrorId}
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

			<CredentialDialog
				presentation={credentialPresentation}
				onClose={closeCredentialPresentation}
				returnFocus={credentialReturnFocusRef}
			/>

			<AlertDialog open={rotationTarget !== null} onOpenChange={(open) => !open && setRotationTarget(null)}>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						rotationTriggerRef.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{rotationTitle}</AlertDialogTitle>
						<AlertDialogDescription>
							{rotationTargetName} will disconnect immediately. Its old credential will stop working, and
							the replacement credential will be shown only once. The controller URL stays the same.
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
							disabled={rotateCredential.isPending}
							loading={rotateCredential.isPending}
							onClick={handleRotate}
						>
							Issue new credential
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={revocationTarget !== null} onOpenChange={(open) => !open && setRevocationTarget(null)}>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						revocationTriggerRef.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>Revoke {revocationTargetName}</AlertDialogTitle>
						<AlertDialogDescription>
							This machine will disconnect and its credential will stop working immediately. Existing
							Sources are retained, and you can issue a new credential later.
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
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							disabled={revokeCredential.isPending}
							onClick={handleRevoke}
						>
							Revoke
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
