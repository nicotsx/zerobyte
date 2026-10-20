import { CheckCircle2, Plus } from "lucide-react";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import { Alert, AlertDescription, AlertTitle } from "~/client/components/ui/alert";
import { Button } from "~/client/components/ui/button";
import { getMachineDisplayName } from "~/lib/machine-name";
import { MachineRow } from "./machine-row";

export function MachineConnectionSuccess({
	agent,
	onDone,
	onCreateSource,
}: {
	agent: ListAgentsResponse[number];
	onDone: () => void;
	onCreateSource: () => void;
}) {
	const machineName = getMachineDisplayName(agent.name);

	return (
		<>
			<Alert variant="success">
				<CheckCircle2 aria-hidden="true" />
				<AlertTitle>{machineName} is connected</AlertTitle>
				<AlertDescription>Your agent is online and ready to use.</AlertDescription>
			</Alert>
			<ul className="min-w-0 divide-y overflow-hidden rounded-lg border" aria-label="Connected machine">
				<MachineRow agent={agent} />
			</ul>
			<div className="flex justify-end gap-2 pt-4 border-t">
				<Button variant="secondary" onClick={onDone}>
					Done
				</Button>
				{agent.capabilities.trustedRoots.some((root) => root.canBackup) && (
					<Button onClick={onCreateSource}>
						<Plus className="h-4 w-4 mr-2" aria-hidden="true" />
						Create a Source
					</Button>
				)}
			</div>
		</>
	);
}
