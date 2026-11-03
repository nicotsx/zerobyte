import { BadRequestError } from "http-errors-enhanced";
import { getBackupRepositoryCompatibility, isAgentRepository } from "@zerobyte/contracts/backup-context";
import { getSafeMachinePresentationLabel } from "~/lib/safe-presentation-label";
import { db } from "~/server/db/db";
import type { Repository } from "~/server/db/schema";
import { serverHasRuntimeFeature } from "~/server/lib/permission-service";
import { LOCAL_AGENT_ID } from "../../agents/constants";
import type { RestoreMachineDto } from "../repositories.dto";

const presentMachineName = (name: string) => getSafeMachinePresentationLabel(name).slice(0, 100);

/**
 * Remote machines that already back up to this repository. Their backup jobs already hand them the repository's
 * credentials and password, so restoring there exposes nothing new. Repositories stored on a machine only accept
 * backups from that machine, so this only ever adds machines for repositories on this server.
 */
const findBackupMachines = async (organizationId: string, repository: Repository) => {
	if (isAgentRepository(repository) || !serverHasRuntimeFeature("remoteAgents")) return [];

	const schedules = await db.query.backupSchedulesTable.findMany({
		where: { AND: [{ repositoryId: repository.id }, { organizationId }] },
		with: { volume: true },
	});
	const agentIds = [
		...new Set(
			schedules
				.map((schedule) => schedule.volume?.agentId)
				.filter((agentId): agentId is string => agentId !== undefined && agentId !== LOCAL_AGENT_ID),
		),
	];
	if (agentIds.length === 0) return [];

	const agents = await db.query.agentsTable.findMany({
		where: {
			AND: [{ id: { in: agentIds } }, { kind: "remote" }, { organizationId }, { revokedAt: { isNull: true } }],
		},
		columns: { id: true, name: true },
	});

	return agents
		.filter((agent) => getBackupRepositoryCompatibility({ agentId: agent.id }, repository).compatible)
		.map((agent) => ({ agentId: agent.id, name: presentMachineName(agent.name) }))
		.sort((a, b) => a.name.localeCompare(b.name));
};

const findOwnerName = async (agentId: string) => {
	if (agentId === LOCAL_AGENT_ID) return null;

	const agent = await db.query.agentsTable.findFirst({ where: { id: agentId }, columns: { name: true } });
	return agent ? presentMachineName(agent.name) : null;
};

/**
 * Machines a repository's snapshots can be restored on: the machine that stores the repository first, then every
 * remote machine that already backs up to it.
 */
export const listRestoreMachines = async (
	organizationId: string,
	repository: Repository,
): Promise<RestoreMachineDto[]> => {
	const [ownerName, backupMachines] = await Promise.all([
		findOwnerName(repository.agentId),
		findBackupMachines(organizationId, repository),
	]);

	return [{ agentId: repository.agentId, name: ownerName }, ...backupMachines];
};

/** The machine a restore runs on: the repository's own machine unless another allowed machine is requested. */
export const resolveRestoreMachine = async (
	organizationId: string,
	repository: Repository,
	requestedAgentId: string | undefined,
) => {
	if (requestedAgentId === undefined || requestedAgentId === repository.agentId) return repository.agentId;

	const backupMachines = await findBackupMachines(organizationId, repository);
	if (!backupMachines.some((machine) => machine.agentId === requestedAgentId)) {
		throw new BadRequestError(
			"Snapshots can only be restored on the machine that stores the repository or on a machine with a backup job using it.",
		);
	}

	return requestedAgentId;
};
