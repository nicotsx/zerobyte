import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import {
	createRemoteAgentMutation,
	deleteRemoteAgentMutation,
	listAgentsOptions,
	revokeRemoteAgentTokenMutation,
	rotateRemoteAgentTokenMutation,
} from "~/client/api-client/@tanstack/react-query.gen";
import { Alert, AlertAction, AlertContent, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { getMachineDisplayName } from "~/lib/machine-name";
import { ConfirmActionDialog, type ConfirmActionDialogProps } from "./confirm-action-dialog";
import {
	ConnectionRequirements,
	CreateMachineDialog,
	CredentialDialog,
	presentCredential,
	type CredentialPresentation,
} from "./machine-connection-dialogs";
import { MachineRow, type MachineAction } from "./machine-row";

/** Kept after closing so the dialog can animate out with its content intact. */
type Confirmation = { action: MachineAction; agentId: string; machineName: string; open: boolean };

type ActionDialog = Omit<ConfirmActionDialogProps, "open" | "onOpenChange" | "returnFocusRef"> & { reset: () => void };

export function MachinesSection() {
	const [createOpen, setCreateOpen] = useState(false);
	const [credential, setCredential] = useState<CredentialPresentation | null>(null);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

	const agentsQuery = useSuspenseQuery({
		...listAgentsOptions(),
		refetchInterval: 5_000,
		refetchIntervalInBackground: false,
	});

	const remoteCount = agentsQuery.data.filter((agent) => agent.kind === "remote").length;

	const connectButtonRef = useRef<HTMLButtonElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);

	const closeConfirmation = () => setConfirmation((current) => current && { ...current, open: false });

	const createAgent = useMutation({
		...createRemoteAgentMutation(),
		gcTime: 0,
		onSuccess: (result) => {
			setCreateOpen(false);
			setCredential(presentCredential(result));
		},
	});

	const rotateCredential = useMutation({
		...rotateRemoteAgentTokenMutation(),
		gcTime: 0,
		onSuccess: (result) => {
			closeConfirmation();
			setCredential(presentCredential(result));
		},
	});

	const revokeCredential = useMutation({ ...revokeRemoteAgentTokenMutation(), onSuccess: closeConfirmation });

	const deleteMachine = useMutation({
		...deleteRemoteAgentMutation(),
		onSuccess: () => {
			returnFocusRef.current = connectButtonRef.current;
			closeConfirmation();
		},
	});

	const machineName = confirmation?.machineName ?? "";
	const path = { agentId: confirmation?.agentId ?? "" };

	const actionDialogs: Record<MachineAction, ActionDialog> = {
		rotate: {
			title: "Get connection command",
			description: `${machineName} will disconnect immediately. Its old credential will stop working, and remote backups may be interrupted until you run the new command on that machine. The command is shown only once. Reconnecting preserves existing Allowed locations, their permissions, and Sources. Use it between backup runs.`,
			confirmLabel: "Get connection command",
			variant: "primary",
			pending: rotateCredential.isPending,
			error: rotateCredential.isError
				? "Could not get the connection command. Nothing was shown; you can try again."
				: null,
			onConfirm: () => rotateCredential.mutate({ path }),
			reset: rotateCredential.reset,
			children: <ConnectionRequirements />,
		},
		revoke: {
			title: `Revoke ${machineName}`,
			description:
				"This machine will disconnect and its credential will stop working immediately. Existing Sources are retained, and you can get a fresh connection command later.",
			confirmLabel: "Revoke",
			variant: "destructive",
			pending: revokeCredential.isPending,
			error: revokeCredential.isError
				? revokeCredential.error?.message || "Could not revoke the connection. Try again."
				: null,
			onConfirm: () => revokeCredential.mutate({ path }),
			reset: revokeCredential.reset,
		},
		delete: {
			title: `Delete ${machineName}?`,
			description: "This machine will disconnect and be removed. Delete its sources first.",
			confirmLabel: "Delete machine",
			variant: "destructive",
			pending: deleteMachine.isPending,
			error: deleteMachine.isError
				? deleteMachine.error?.message || "Could not delete the machine. Try again."
				: null,
			onConfirm: () => deleteMachine.mutate({ path }),
			reset: deleteMachine.reset,
		},
	};

	const confirm = (action: MachineAction, agentId: string, name: string) => {
		actionDialogs[action].reset();
		setConfirmation({ action, agentId, machineName: name, open: true });
	};

	const closeCredential = () => {
		setCredential(null);
		createAgent.reset();
		rotateCredential.reset();
	};

	return (
		<>
			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm font-medium">
						{remoteCount === 0
							? "No remote machines"
							: `${remoteCount} remote machine${remoteCount === 1 ? "" : "s"}`}
					</p>
					<Button
						ref={connectButtonRef}
						type="button"
						variant="primary"
						className="w-full sm:w-auto"
						onClick={(event) => {
							returnFocusRef.current = event.currentTarget;
							createAgent.reset();
							setCreateOpen(true);
						}}
					>
						<Plus className="mr-2 h-4 w-4" aria-hidden="true" />
						Connect machine
					</Button>
				</div>

				{agentsQuery.isError && (
					<Alert variant="destructive">
						<AlertContent>
							<AlertTitle>Could not refresh machines</AlertTitle>
							<AlertDescription>Showing the last known details.</AlertDescription>
						</AlertContent>
						<AlertAction>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => void agentsQuery.refetch()}
								loading={agentsQuery.isFetching}
							>
								<RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
								Retry
							</Button>
						</AlertAction>
					</Alert>
				)}

				<ul className="min-w-0 divide-y overflow-hidden rounded-lg border" aria-label="Machines">
					{agentsQuery.data.map((agent) => (
						<MachineRow
							key={agent.id}
							agent={agent}
							onAction={(action, target, trigger) => {
								returnFocusRef.current = trigger;
								confirm(action, target.id, getMachineDisplayName(target.name));
							}}
						/>
					))}
				</ul>
			</div>

			<CreateMachineDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				pending={createAgent.isPending}
				failed={createAgent.isError}
				onCreate={(name) => createAgent.mutate({ body: { name } })}
			/>

			<CredentialDialog credential={credential} onClose={closeCredential} returnFocusRef={returnFocusRef} />

			{confirmation && (
				<ConfirmActionDialog
					{...actionDialogs[confirmation.action]}
					open={confirmation.open}
					onOpenChange={(open) => !open && closeConfirmation()}
					returnFocusRef={returnFocusRef}
				/>
			)}
		</>
	);
}
