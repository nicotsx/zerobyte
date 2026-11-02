import { getBackupRepositoryCompatibility } from "@zerobyte/contracts/backup-context";
import type { Repository, Volume } from "~/server/db/schema";
import { BadRequestError } from "http-errors-enhanced";

export const assertBackupRepositoryCompatibility = (
	volume: Pick<Volume, "agentId">,
	repository: Pick<Repository, "type" | "agentId">,
) => {
	const compatibility = getBackupRepositoryCompatibility(volume, repository);
	if (!compatibility.compatible) {
		throw new BadRequestError(compatibility.reason);
	}
};
