import { createConnectionCommand, type ConnectionPurpose } from "./connection-command";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	createRemoteAgentMutation,
	rotateRemoteAgentTokenMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "~/client/components/ui/alert-dialog";
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
import {
	getMachineDisplayName,
	isValidMachineName,
	MACHINE_NAME_MAX_LENGTH,
	normalizeMachineName,
} from "~/lib/machine-name";
import { connectionPurpose } from "./machine-presentation";

type Agent = ListAgentsResponse[number];

type CredentialPresentation = {
	agentId: string;
	purpose: ConnectionPurpose;
	purposeChosenByUser?: boolean;
	machineName: string;
	controllerUrl: string;
	token: string;
	expiresAt: number;
};

type RotationTarget = {
	agentId: string;
	machineName: string;
	purpose: ConnectionPurpose;
	purposeChosenByUser?: boolean;
	fromCommand: boolean;
};

const installationGuide = "https://zerobyte.app/docs/guides/remote-agents";

function ConnectionRequirements() {
	return (
		<p className="text-pretty text-sm text-muted-foreground">
			Requires Linux x64 or ARM64 with glibc and systemd, sudo access, and Restic 0.18.0 or newer on the service
			PATH.{" "}
			<a href={installationGuide} target="_blank" rel="noreferrer" className="underline underline-offset-4">
				Installation guide
			</a>
		</p>
	);
}

const createCredentialMutationKey = ["remote-agent-credential", "create"] as const;
const rotateCredentialMutationKey = ["remote-agent-credential", "rotate"] as const;

const resolveConnectionPurpose = (
	agent: Agent | undefined,
	choice: Pick<CredentialPresentation, "purpose" | "purposeChosenByUser">,
): ConnectionPurpose =>
	!choice.purposeChosenByUser && agent && connectionPurpose(agent) === "reconnect" ? "reconnect" : choice.purpose;

function CopyField({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	const [clipboardResult, setClipboardResult] = useState<"success" | "error" | null>(null);

	const commandRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!copied) return;
		const timeout = window.setTimeout(() => setCopied(false), 3_000);
		return () => window.clearTimeout(timeout);
	}, [copied]);

	return (
		<div className="min-w-0 space-y-2">
			<Label htmlFor="machine-connection-command">Connection command</Label>
			<div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/35 p-2">
				<textarea
					ref={commandRef}
					id="machine-connection-command"
					readOnly
					value={value}
					rows={6}
					className="field-sizing-content min-h-24 min-w-0 flex-1 resize-none break-all bg-transparent py-1 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onFocus={(event) => event.currentTarget.select()}
					onClick={(event) => event.currentTarget.select()}
				/>
				<Button
					type="button"
					variant="outline"
					size="icon"
					className="size-10 shrink-0 transition-transform active:scale-[0.96]"
					aria-label={copied ? "Copied connection command" : "Copy connection command"}
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(value);
							setCopied(true);
							setClipboardResult("success");
						} catch {
							setCopied(false);
							setClipboardResult("error");
							commandRef.current?.focus();
							commandRef.current?.select();
						}
					}}
				>
					{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
				</Button>
			</div>
			<p
				aria-live="polite"
				aria-atomic="true"
				className={clipboardResult === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
			>
				{clipboardResult === "success" && "Connection command copied."}
				{clipboardResult === "error" &&
					"Could not copy. The command is selected; copy it with Ctrl+C or Command+C."}
			</p>
		</div>
	);
}

function CredentialDialog({
	presentation,
	onClose,
	onExpire,
	onRegenerate,
	onPurposeChange,
	pending,
	error,
	returnFocus,
}: {
	presentation: CredentialPresentation | null;
	onClose: () => void;
	onExpire: () => void;
	onRegenerate: (trigger: HTMLButtonElement) => void;
	onPurposeChange: (purpose: ConnectionPurpose) => void;
	pending: boolean;
	error: boolean;
	returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
	const [now, setNow] = useState(Date.now);

	const { formatDateTime } = useTimeFormat();

	const isOpen = presentation !== null;
	const token = presentation?.token ?? "";
	const controllerUrl = presentation?.controllerUrl ?? "";
	const expired = !token || now >= (presentation?.expiresAt ?? 0);
	const connectionCommand =
		/^wss?:/.test(controllerUrl) && !expired
			? createConnectionCommand(controllerUrl, token, presentation?.purpose)
			: "";
	const hasController = /^wss?:/.test(controllerUrl);
	const remainingMinutes = Math.max(1, Math.ceil(((presentation?.expiresAt ?? 0) - now) / 60_000));
	const reconnecting = presentation?.purpose === "reconnect";

	useEffect(() => {
		if (!presentation?.token) return;
		const ticker = window.setInterval(() => setNow(Date.now()), 1_000);
		const expiry = window.setTimeout(onExpire, Math.max(0, presentation.expiresAt - Date.now()));

		return () => {
			window.clearInterval(ticker);
			window.clearTimeout(expiry);
		};
	}, [presentation, onExpire]);

	const handleOpenChange = (open: boolean) => {
		if (open || pending) return;
		onClose();
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleOpenChange}>
			<DialogContent
				className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
				showCloseButton={!pending}
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (pending) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocus.current?.focus();
				}}
			>
				<DialogHeader>
					<DialogTitle className="min-w-0 [overflow-wrap:anywhere] pr-6 leading-snug">
						{reconnecting ? "Reconnect" : "Connect"} {presentation?.machineName}
					</DialogTitle>
					<DialogDescription>
						{reconnecting
							? "Run this command on the existing agent for this same Zerobyte machine. It replaces the credential and restarts the agent, preserving this machine’s Allowed locations, permissions, and Sources."
							: "Run this command on the remote machine to install and connect the agent."}
					</DialogDescription>
				</DialogHeader>

				<div className="min-w-0 space-y-4">
					<ConnectionRequirements />
					<div className="space-y-2">
						<div className="flex items-start gap-2">
							<Checkbox
								id="machine-agent-installed"
								checked={reconnecting}
								disabled={pending}
								onCheckedChange={(checked) =>
									onPurposeChange(checked === true ? "reconnect" : "connect")
								}
								aria-describedby="machine-agent-installed-hint"
							/>
							<Label htmlFor="machine-agent-installed" className="leading-snug">
								Agent already installed on this machine
							</Label>
						</div>
						<p id="machine-agent-installed-hint" className="text-pretty text-xs text-muted-foreground">
							Use only for an existing installation of this same machine, including one that has never
							appeared online. To reconnect another machine, close this dialog and use its existing row’s
							Actions menu.
						</p>
					</div>
					{expired ? (
						<output className="block rounded-md border border-amber-600/25 bg-amber-500/10 p-3 text-sm">
							This connection code has expired. Get a fresh command for this same machine.
						</output>
					) : (
						<>
							<p className="text-sm text-muted-foreground">
								Single-use code · expires {formatDateTime(presentation!.expiresAt)} (about{" "}
								{remainingMinutes} {remainingMinutes === 1 ? "minute" : "minutes"} remaining).
							</p>
							{hasController && (
								<CopyField key={`${token}-${presentation?.purpose}`} value={connectionCommand} />
							)}
						</>
					)}
					<p className="text-pretty text-sm text-muted-foreground">
						This code is shown only once. After closing, use this machine’s Actions menu to get a fresh
						connection command.
					</p>
					{!reconnecting && (
						<p className="text-pretty text-sm text-muted-foreground">
							After connection, choose Allowed locations with <code>sudo zerobyte-agent folders add</code>{" "}
							on the remote machine, then create a Source in Zerobyte.
						</p>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							Could not get a fresh connection command. Try again.
						</p>
					)}
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						aria-label="Close connection command"
						disabled={pending}
						onClick={() => handleOpenChange(false)}
					>
						Close
					</Button>
					{expired && (
						<Button
							type="button"
							variant="primary"
							loading={pending}
							onClick={(event) => onRegenerate(event.currentTarget)}
						>
							Get fresh command
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function useMachineConnection({
	agents,
	controllerUrl,
	connectTriggerRef,
}: {
	agents: ListAgentsResponse;
	controllerUrl: string;
	connectTriggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [machineName, setMachineName] = useState("");

	const [credentialPresentation, setCredentialPresentation] = useState<CredentialPresentation | null>(null);

	const [rotationTarget, setRotationTarget] = useState<RotationTarget | null>(null);

	const normalizedMachineName = normalizeMachineName(machineName);

	const machineNameIsValid = isValidMachineName(machineName);
	const machineNameHasError = machineName.length > 0 && !machineNameIsValid;
	const machineNameHintId = "remote-machine-name-hint";
	const machineNameErrorId = "remote-machine-name-error";

	const machineNameDescriptionIds = machineNameHasError
		? `${machineNameHintId} ${machineNameErrorId}`
		: machineNameHintId;

	const machineNameInputRef = useRef<HTMLInputElement>(null);
	const rotationTriggerRef = useRef<HTMLButtonElement>(null);
	const credentialReturnFocusRef = useRef<HTMLButtonElement>(null);

	const connectionPurposeRef = useRef<ConnectionPurpose>("connect");

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
				agentId: result.agent.id,
				purpose: "connect",
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
			if (rotationTarget && !rotationTarget.fromCommand && rotationTriggerRef.current)
				credentialReturnFocusRef.current = rotationTriggerRef.current;
			setRotationTarget(null);
			setCredentialPresentation({
				agentId: result.agent.id,
				purpose: connectionPurposeRef.current,
				purposeChosenByUser: rotationTarget?.purposeChosenByUser,
				machineName: getMachineDisplayName(result.agent.name),
				controllerUrl,
				token: result.token,
				expiresAt: result.expiresAt,
			});
		},
	});

	const closeCreateDialog = () => {
		if (createAgent.isPending) return;

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

		const latestAgent = agents.find((agent) => agent.id === target.agentId);
		connectionPurposeRef.current = resolveConnectionPurpose(latestAgent, target);

		rotateCredential.mutate({ path: { agentId: target.agentId } });
	};

	const selectRotationTarget = (agent: Agent, trigger: HTMLButtonElement) => {
		rotateCredential.reset();
		rotationTriggerRef.current = trigger;
		setRotationTarget({
			agentId: agent.id,
			machineName: getMachineDisplayName(agent.name),
			purpose: connectionPurpose(agent),
			fromCommand: false,
		});
	};

	const rotationTitle = rotationTarget?.purpose === "reconnect" ? "Reconnect machine" : "Get connection command";
	const rotationTargetName = rotationTarget?.machineName ?? "";

	const removeCredentialMutations = () => {
		if (!createAgent.isPending) createAgent.reset();
		if (!rotateCredential.isPending) rotateCredential.reset();

		const mutationCache = queryClient.getMutationCache();
		const createMutations = mutationCache.findAll({ mutationKey: createCredentialMutationKey });
		const rotateMutations = mutationCache.findAll({ mutationKey: rotateCredentialMutationKey });
		const credentialMutations = [...createMutations, ...rotateMutations];

		for (const mutation of credentialMutations) {
			if (mutation.state.status !== "pending") mutationCache.remove(mutation);
		}
	};

	const closeCredentialPresentation = () => {
		if (rotateCredential.isPending) return;

		setCredentialPresentation(null);
		removeCredentialMutations();
	};

	const expireCredentialPresentation = () => {
		setCredentialPresentation((current) => (current ? { ...current, token: "" } : current));
		removeCredentialMutations();
	};

	const regenerateConnectionCommand = (trigger: HTMLButtonElement) => {
		if (!credentialPresentation || rotateCredential.isPending) return;

		const latestAgent = agents.find((agent) => agent.id === credentialPresentation.agentId);
		const purpose = resolveConnectionPurpose(latestAgent, credentialPresentation);
		const machineName = latestAgent ? getMachineDisplayName(latestAgent.name) : credentialPresentation.machineName;

		rotateCredential.reset();
		rotationTriggerRef.current = trigger;
		setCredentialPresentation({ ...credentialPresentation, machineName, purpose });
		setRotationTarget({
			agentId: credentialPresentation.agentId,
			machineName,
			purpose,
			purposeChosenByUser: credentialPresentation.purposeChosenByUser,
			fromCommand: true,
		});
	};

	const dialogs = (
		<>
			<Dialog
				open={createDialogOpen}
				onOpenChange={(open) => (open ? setCreateDialogOpen(true) : closeCreateDialog())}
			>
				<DialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
					showCloseButton={!createAgent.isPending}
					onEscapeKeyDown={(event) => {
						if (createAgent.isPending) event.preventDefault();
					}}
					onInteractOutside={(event) => {
						if (createAgent.isPending) event.preventDefault();
					}}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						machineNameInputRef.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						connectTriggerRef.current?.focus();
					}}
				>
					<form onSubmit={handleCreate} className="space-y-5" aria-busy={createAgent.isPending}>
						<DialogHeader>
							<DialogTitle>Connect a remote machine</DialogTitle>
							<DialogDescription>
								Name a new machine to install its agent. For an existing installation, close this dialog
								and use that machine’s Actions menu instead.
							</DialogDescription>
						</DialogHeader>
						<ConnectionRequirements />
						<div className="space-y-2">
							<Label htmlFor="remote-machine-name">Machine name</Label>
							<Input
								ref={machineNameInputRef}
								id="remote-machine-name"
								value={machineName}
								disabled={createAgent.isPending}
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
								Could not get the connection command. Check the name and try again.
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={createAgent.isPending}
								onClick={closeCreateDialog}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								variant="primary"
								loading={createAgent.isPending}
								disabled={!machineNameIsValid}
							>
								Get connection command
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<CredentialDialog
				key={credentialPresentation?.expiresAt ?? "closed"}
				presentation={credentialPresentation}
				onClose={closeCredentialPresentation}
				onExpire={expireCredentialPresentation}
				onRegenerate={regenerateConnectionCommand}
				onPurposeChange={(purpose) =>
					setCredentialPresentation((current) =>
						current ? { ...current, purpose, purposeChosenByUser: true } : current,
					)
				}
				pending={rotateCredential.isPending}
				error={rotateCredential.isError}
				returnFocus={credentialReturnFocusRef}
			/>

			<AlertDialog
				open={rotationTarget !== null}
				onOpenChange={(open) => {
					if (!open && !rotateCredential.isPending) setRotationTarget(null);
				}}
			>
				<AlertDialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
					onEscapeKeyDown={(event) => {
						if (rotateCredential.isPending) event.preventDefault();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						rotationTriggerRef.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">
							{rotationTitle}
						</AlertDialogTitle>
						<AlertDialogDescription className="min-w-0 [overflow-wrap:anywhere]">
							{rotationTargetName} will disconnect immediately. Its old credential will stop working, and
							remote backups may be interrupted until you run the new command on that machine. The command
							is shown only once. Reconnecting preserves existing Allowed locations, their permissions,
							and Sources. Use it between backup runs.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<ConnectionRequirements />
					{rotateCredential.isError && (
						<p role="alert" className="text-sm text-destructive">
							Could not get the connection command. Nothing was shown; you can try again.
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
							Get connection command
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);

	return { openCreate: () => setCreateDialogOpen(true), openRotate: selectRotationTarget, dialogs };
}
