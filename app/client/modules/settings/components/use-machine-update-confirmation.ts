import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { AgentUpdateRequestError, queueAgentUpdate } from "~/client/lib/agent-updates";
import { getMachineDisplayName } from "~/lib/machine-name";
import type { ConfirmActionDialogProps } from "./confirm-action-dialog";

type UpdateConfirmation = {
	agentId: string;
	credentialVersion: number;
	machineName: string;
	tag: string;
	open: boolean;
};

export function useMachineUpdateConfirmation(connectButtonRef: RefObject<HTMLButtonElement | null>) {
	const [confirmation, setConfirmation] = useState<UpdateConfirmation | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);

	const close = () => setConfirmation((current) => current && { ...current, open: false });

	const mutation = useMutation({
		networkMode: "always",
		mutationFn: queueAgentUpdate,
		onSuccess: () => {
			triggerRef.current = null;
			toast.success("Agent update requested");
			close();
		},
	});

	const open = (agent: ListAgentsResponse[number], tag: string, trigger: HTMLButtonElement) => {
		mutation.reset();
		triggerRef.current = trigger;

		setConfirmation({
			agentId: agent.id,
			credentialVersion: agent.credentialVersion,
			machineName: getMachineDisplayName(agent.name),
			tag,
			open: true,
		});
	};

	if (!confirmation) return { open };

	const offerChanged = mutation.error instanceof AgentUpdateRequestError && mutation.error.status === 409;

	const dialog: ConfirmActionDialogProps = {
		open: confirmation.open,
		onOpenChange: (open) => {
			if (!open && !mutation.isPending) close();
		},
		title: `Update ${confirmation.machineName}?`,
		description: `Request agent ${confirmation.tag}. The request stays queued until the agent checks in. The agent waits for running jobs to finish before installing the update.`,
		confirmLabel: "Queue update",
		variant: "primary",
		pending: mutation.isPending,
		lockDismissal: mutation.isPending,
		disabled: offerChanged,
		error: mutation.error?.message ?? null,
		returnFocusRef: triggerRef,
		getFallbackFocus: () => connectButtonRef.current,
		onConfirm: () => {
			if (offerChanged || mutation.isPending) return;

			mutation.mutate({
				path: { agentId: confirmation.agentId },
				body: { targetTag: confirmation.tag, credentialVersion: confirmation.credentialVersion },
			});
		},
	};

	return { open, dialog };
}
