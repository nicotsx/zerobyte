import type { GetRepositoryDto } from "./repositories.dto";
import type { Repository } from "~/server/db/schema";
import { redactRepositoryConfig } from "./repository-config-secrets";

export const presentRepository = (repository: Repository): GetRepositoryDto => ({
	id: repository.id,
	shortId: repository.shortId,
	provisioningId: repository.provisioningId,
	name: repository.name,
	type: repository.type,
	config: redactRepositoryConfig(repository.config),
	compressionMode: repository.compressionMode,
	status: repository.status,
	lastChecked: repository.lastChecked,
	lastError: repository.lastError,
	doctorResult: repository.doctorResult,
	autoCheckEnabled: repository.autoCheckEnabled,
	createdAt: repository.createdAt,
	updatedAt: repository.updatedAt,
});
