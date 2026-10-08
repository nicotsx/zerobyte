import { getBackupRepositoryCompatibility } from "@zerobyte/contracts/backup-context";
import type { Repository, Volume } from "~/server/db/schema";
import { BadRequestError } from "http-errors-enhanced";

export const assertBackupRepositoryCompatibility = (
	volume: Pick<Volume, "agentId">,
	repository: Pick<Repository, "type">,
) => {
	const compatibility = getBackupRepositoryCompatibility(volume, repository.type);
	if (!compatibility.compatible) {
		throw new BadRequestError(compatibility.reason);
	}
};
