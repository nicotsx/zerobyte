import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import {
	deleteRemoteAgentMutation,
	listAgentsOptions,
	revokeRemoteAgentTokenMutation,
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
import { Skeleton } from "~/client/components/ui/skeleton";
import { getMachineDisplayName } from "~/lib/machine-name";
import { MachineRow } from "./machine-row";
import { useMachineConnection } from "./machine-connection-flow";

type Agent = ListAgentsResponse[number];

export function MachinesSection({ controllerUrl }: { controllerUrl: string }) {
	const [deletionTarget, setDeletionTarget] = useState<Agent | null>(null);
	const [revocationTarget, setRevocationTarget] = useState<Agent | null>(null);

	const agentsQuery = useQuery({
		...listAgentsOptions(),
		refetchInterval: 5_000,
		refetchIntervalInBackground: false,
	});

	const agents = agentsQuery.data ?? [];
	const hasMachineData = agentsQuery.data !== undefined;

	const remoteAgents = agents.filter((agent) => agent.kind === "remote");
	const remoteCount = remoteAgents.length;
	const remoteMachineLabel =
		remoteCount === 0 ? "No remote machines" : `${remoteCount} remote machine${remoteCount === 1 ? "" : "s"}`;

	const connectTriggerRef = useRef<HTMLButtonElement>(null);
	const revocationTriggerRef = useRef<HTMLButtonElement>(null);
	const deletionTriggerRef = useRef<HTMLButtonElement>(null);

	const connection = useMachineConnection({ agents, controllerUrl, connectTriggerRef });

	const deleteMachine = useMutation({
		...deleteRemoteAgentMutation(),
		onSuccess: () => {
			deletionTriggerRef.current = connectTriggerRef.current;
			setDeletionTarget(null);
		},
	});

	const revokeCredential = useMutation({
		...revokeRemoteAgentTokenMutation(),
		onSuccess: () => {
			setRevocationTarget(null);
		},
	});

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

	const revocationTargetName = revocationTarget ? getMachineDisplayName(revocationTarget.name) : "";
	const deletionTargetName = deletionTarget ? getMachineDisplayName(deletionTarget.name) : "";

	return (
		<>
			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					{hasMachineData && <p className="text-sm font-medium">{remoteMachineLabel}</p>}
					<Button
						ref={connectTriggerRef}
						type="button"
						variant="primary"
						className="w-full sm:w-auto"
						onClick={connection.openCreate}
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
					<div
						role="alert"
						className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
					>
						<div className="min-w-0 space-y-1">
							<p className="text-sm font-medium">
								{hasMachineData ? "Could not refresh machines" : "Could not load machines"}
							</p>
							<p className="text-xs text-muted-foreground">
								{hasMachineData
									? "Showing the last known details."
									: "Check your connection and try again."}
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="self-start sm:self-auto"
							onClick={() => void agentsQuery.refetch()}
							loading={agentsQuery.isFetching}
						>
							<RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
							Retry
						</Button>
					</div>
				)}

				{hasMachineData && (
					<ul className="min-w-0 divide-y overflow-hidden rounded-lg border" aria-label="Machines">
						{agents.map((agent) => (
							<MachineRow
								key={agent.id}
								agent={agent}
								onRotate={connection.openRotate}
								onRevoke={selectRevocationTarget}
								onDelete={(agent, trigger) => {
									deleteMachine.reset();
									deletionTriggerRef.current = trigger;
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
					if (!open && !deleteMachine.isPending) setDeletionTarget(null);
				}}
			>
				<AlertDialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
					onEscapeKeyDown={(event) => {
						if (deleteMachine.isPending) event.preventDefault();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						deletionTriggerRef.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">
							Delete {deletionTargetName}?
						</AlertDialogTitle>
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
						<AlertDialogCancel disabled={deleteMachine.isPending}>Cancel</AlertDialogCancel>
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

			{connection.dialogs}

			<AlertDialog
				open={revocationTarget !== null}
				onOpenChange={(open) => {
					if (!open && !revokeCredential.isPending) setRevocationTarget(null);
				}}
			>
				<AlertDialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
					onEscapeKeyDown={(event) => {
						if (revokeCredential.isPending) event.preventDefault();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						revocationTriggerRef.current?.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle className="min-w-0 [overflow-wrap:anywhere]">
							Revoke {revocationTargetName}
						</AlertDialogTitle>
						<AlertDialogDescription>
							This machine will disconnect and its credential will stop working immediately. Existing
							Sources are retained, and you can get a fresh connection command later.
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
							loading={revokeCredential.isPending}
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
