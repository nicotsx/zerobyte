import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { Button } from "~/client/components/ui/button";
import { getRemoteUpdateTarget, isAgentUpdateActive } from "~/client/lib/agent-updates";
import { getMachineDisplayName } from "~/lib/machine-name";

type Agent = ListAgentsResponse[number];
type UpdateRequest = NonNullable<Agent["update"]["request"]>;

function getRequestMessage(request: UpdateRequest) {
	const tag = request.targetTag;
	switch (request.status) {
		case "queued":
			return `Update to ${tag} queued. Waiting for the agent to check in.`;
		case "started":
			return `Update to ${tag} started. Zerobyte will confirm completion when the updated agent reconnects.`;
		case "failed":
			return `Update to ${tag} failed.`;
		case "completed":
			return `Update to ${tag} completed. The updated agent reconnected.`;
		case "superseded":
			return `Update to ${tag} was superseded.`;
	}
}

export function MachineUpdate({
	agent,
	onRequest,
}: {
	agent: Agent;
	onRequest: (tag: string, trigger: HTMLButtonElement) => void;
}) {
	const { availability, delivery, targetTag, request } = agent.update;
	const active = isAgentUpdateActive(request);
	const remoteTarget = getRemoteUpdateTarget(agent.update);
	const manual = availability !== "none" && delivery === "manual";
	const retry = request?.status === "failed" && request.targetTag === remoteTarget;
	const actionLabel = retry ? "Retry update" : "Update agent";
	const machineName = getMachineDisplayName(agent.name);

	if (availability === "none" && !request) return null;

	return (
		<div className="space-y-2 text-sm">
			{availability === "required" && (
				<p className="text-destructive">Backups from this machine are blocked until the agent is updated.</p>
			)}
			<output className="block text-muted-foreground empty:absolute">
				{request && getRequestMessage(request)}
			</output>
			{remoteTarget && (
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={active}
					aria-label={`${actionLabel} for ${machineName}`}
					onClick={(event) => onRequest(remoteTarget, event.currentTarget)}
				>
					{actionLabel}
				</Button>
			)}
			{manual && !active && (
				<div>
					{targetTag && <p className="text-muted-foreground">Target version {targetTag}</p>}
					<a
						href="https://zerobyte.app/docs/guides/remote-agents#manual-updates"
						target="_blank"
						rel="noreferrer"
						className="text-primary underline underline-offset-4"
						aria-label={`How to update ${machineName} (opens in a new tab)`}
					>
						How to update
					</a>
				</div>
			)}
		</div>
	);
}
