import {
	BUILT_IN_LOCAL_AGENT_ID,
	getBackupRepositoryCompatibility,
	type BackupSource,
} from "@zerobyte/contracts/backup-context";
import type { Repository, Volume } from "~/client/lib/types";
import { isFilesystemSourceActionable } from "~/client/modules/volumes/source-presentation";

export const getBackupSource = (volume: Volume): BackupSource => {
	if (volume.sourceKind === "managed") {
		return { kind: "managed" };
	}

	const agentKind = volume.agentId === BUILT_IN_LOCAL_AGENT_ID ? "local" : "remote";
	return { kind: "filesystem", agentKind };
};

export const getRepositoryCompatibility = (volume: Volume, repository: Pick<Repository, "type">) => {
	const source = getBackupSource(volume);
	return getBackupRepositoryCompatibility(source, repository.type);
};

export const getSourceLabel = (volume: Volume) => {
	if (volume.sourceKind === "managed" || volume.agentId === BUILT_IN_LOCAL_AGENT_ID) {
		return volume.name;
	}

	return `${volume.sourceLocation.machine.name} · ${volume.name}`;
};

export const getBackupContextLabel = (volume: Volume, repositoryName: string) =>
	`${getSourceLabel(volume)} → ${repositoryName}`;

export const getBackupRunBlockReason = (volume: Volume, repository: Pick<Repository, "type">) => {
	const compatibility = getRepositoryCompatibility(volume, repository);
	if (!compatibility.compatible) {
		return compatibility.reason;
	}

	if (volume.sourceKind === "managed" || volume.agentId === BUILT_IN_LOCAL_AGENT_ID) {
		return null;
	}

	const sourceIsActionable = isFilesystemSourceActionable(volume.sourceLocation);
	if (sourceIsActionable) {
		return null;
	}

	const availability = volume.sourceLocation.availability;
	if (availability === "disabled") {
		return "Remote agents are disabled on this instance. Contact the instance administrator to run this backup.";
	}
	if (availability === "offline") {
		return "The remote agent for this source is offline. Reconnect it before running this backup.";
	}
	if (availability === "connecting") {
		return "The remote agent for this source is connecting. Wait for it to be ready before running this backup.";
	}
	if (availability === "degraded") {
		return "The remote agent for this source has a degraded connection. Reconnect it before running this backup.";
	}
	if (availability === "not-ready") {
		return "The remote agent for this source is not ready. Wait for it to be ready before running this backup.";
	}
	if (availability === "revoked") {
		return "The source machine is revoked. Repair the source before running this backup.";
	}
	if (availability === "missing-agent") {
		return "The source machine is unavailable. Repair the source before running this backup.";
	}
	if (availability === "root-removed") {
		return "The source location is no longer available. Repair the source before running this backup.";
	}
	if (availability === "backup-disabled") {
		return "This source location no longer allows backups.";
	}

	return "The source is incompatible. Repair it before running this backup.";
};
