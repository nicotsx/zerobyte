import type { SourceMachine } from "@zerobyte/contracts/volumes";
import { BadRequestError, NotFoundError, ServiceUnavailableError } from "http-errors-enhanced";
import { getSafeMachinePresentationLabel } from "~/lib/safe-presentation-label";
import { db } from "~/server/db/db";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { presentAgentCapabilities } from "../agents/agent-capability-presentation";

export const listSourceMachines = async (organizationId: string): Promise<SourceMachine[]> => {
	if (!serverHasRuntimeFeature("remoteAgents"))
		throw new ServiceUnavailableError("Remote agents are disabled on this instance.");

	const agents = await db.query.agentsTable.findMany({
		where: { AND: [{ organizationId: { eq: organizationId } }, { kind: { eq: "remote" } }] },
		orderBy: { createdAt: "asc" },
	});

	return agents.map((agent) => ({
		id: agent.id,
		name: getSafeMachinePresentationLabel(agent.name).slice(0, 100),
		status: agent.status,
		lastSeenAt: agent.lastSeenAt,
		revokedAt: agent.revokedAt,
		trustedRoots: presentAgentCapabilities(agent.capabilities).trustedRoots,
	}));
};

export const validateTrustedRoot = async (agentId: string, rootId: string, organizationId: string) => {
	const local = agentId === LOCAL_AGENT_ID;
	if (!local && !serverHasRuntimeFeature("remoteAgents"))
		throw new ServiceUnavailableError("Remote agents are disabled on this instance.");

	let agent;
	if (local) {
		agent = await db.query.agentsTable.findFirst({
			where: { AND: [{ id: LOCAL_AGENT_ID }, { kind: "local" }, { organizationId: { isNull: true } }] },
		});
	} else {
		agent = await db.query.agentsTable.findFirst({
			where: { AND: [{ id: agentId }, { kind: "remote" }, { organizationId }] },
		});
	}

	if (!agent) throw new NotFoundError("Source machine not found");
	if (agent.revokedAt !== null) throw new BadRequestError("Source machine is revoked");

	const root = agent.capabilities.trustedRoots?.find((candidate) => candidate.id === rootId);
	if (!root) throw new BadRequestError(`Trusted root "${rootId}" is not advertised by the source machine`);
	if (!root.canBackup) throw new BadRequestError("Trusted root does not allow backups");

	return root;
};
