import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listAgentsOptions } from "~/client/api-client/@tanstack/react-query.gen";
import { Badge } from "~/client/components/ui/badge";
import { useOrganizationContext } from "~/client/hooks/use-org-context";
import { usePermissions } from "~/client/hooks/use-permissions";
import { getMachineUpdate } from "~/client/lib/agent-updates";

export function DashboardAgentUpdates() {
	const permissions = usePermissions();
	const { activeOrganization } = useOrganizationContext();
	const organizationId = activeOrganization.id;
	const enabled =
		permissions.activeOrganizationId === organizationId &&
		permissions.can("agents.manage") &&
		permissions.hasRuntimeFeature("remoteAgents");

	const { data: agents } = useQuery({
		...listAgentsOptions({ query: { expectedOrganizationId: organizationId } }),
		enabled,
	});

	if (!enabled || !agents) return null;

	let required = 0;
	let available = 0;
	for (const agent of agents) {
		const availability = getMachineUpdate(agent)?.availability;
		if (availability === "required") required++;
		if (availability === "available") available++;
	}

	const count = required + available;
	if (count === 0) return null;

	return (
		<Badge asChild variant={required > 0 ? "destructive" : "secondary"} className="mr-1">
			<Link to="/settings" search={{ scope: "organization" }} hash="machines">
				{count} agent {count === 1 ? "update" : "updates"}
				<span className="sr-only">
					, {required} required and {available} optional. Open Machines settings.
				</span>
			</Link>
		</Badge>
	);
}
