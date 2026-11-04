import { getSafeMachinePresentationLabel } from "~/lib/safe-presentation-label";
import { db } from "~/server/db/db";
import type { Repository } from "~/server/db/schema";
import { LOCAL_AGENT_ID } from "../agents/constants";
import type { GetRepositoryDto } from "./repositories.dto";
import { redactRepositoryConfig } from "./repository-config-secrets";

export const presentRepositories = async (repositories: readonly Repository[]): Promise<GetRepositoryDto[]> => {
	const agentIds = [...new Set(repositories.map((repository) => repository.agentId))].filter(
		(agentId) => agentId !== LOCAL_AGENT_ID,
	);

	const agents =
		agentIds.length === 0
			? []
			: await db.query.agentsTable.findMany({
					where: { id: { in: agentIds } },
					columns: { id: true, name: true },
				});
	const agentNames = new Map(
		agents.map((agent) => [agent.id, getSafeMachinePresentationLabel(agent.name).slice(0, 100)]),
	);

	return repositories.map((repository) => ({
		id: repository.id,
		shortId: repository.shortId,
		provisioningId: repository.provisioningId,
		name: repository.name,
		type: repository.type,
		agentId: repository.agentId,
		agentName: repository.agentId === LOCAL_AGENT_ID ? null : (agentNames.get(repository.agentId) ?? null),
		config: redactRepositoryConfig(repository.config),
		compressionMode: repository.compressionMode,
		status: repository.status,
		lastChecked: repository.lastChecked,
		lastError: repository.lastError,
		doctorResult: repository.doctorResult,
		autoCheckEnabled: repository.autoCheckEnabled,
		createdAt: repository.createdAt,
		updatedAt: repository.updatedAt,
	}));
};

export const presentRepository = async (repository: Repository): Promise<GetRepositoryDto> =>
	(await presentRepositories([repository]))[0]!;
