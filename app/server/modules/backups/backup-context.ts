import { getBackupRepositoryCompatibility, type BackupSource } from "@zerobyte/contracts/backup-context";
import type { Repository, Volume } from "~/server/db/schema";
import { BadRequestError } from "http-errors-enhanced";
import { LOCAL_AGENT_ID } from "../agents/constants";

export const getBackupSource = (volume: Pick<Volume, "sourceKind" | "agentId">): BackupSource => {
	if (volume.sourceKind === "managed") {
		return { kind: "managed" };
	}

	const agentKind = volume.agentId === LOCAL_AGENT_ID ? "local" : "remote";
	return { kind: "agent-filesystem", agentKind };
};

export const assertBackupRepositoryCompatibility = (
	volume: Pick<Volume, "sourceKind" | "agentId">,
	repository: Pick<Repository, "type">,
) => {
	const source = getBackupSource(volume);
	const compatibility = getBackupRepositoryCompatibility(source, repository.type);
	if (!compatibility.compatible) {
		throw new BadRequestError(compatibility.reason);
	}
};
