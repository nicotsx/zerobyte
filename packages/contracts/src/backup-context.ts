import type { RepositoryBackend } from "@zerobyte/core/restic";

export const BUILT_IN_LOCAL_AGENT_ID = "local";

export type BackupRepositoryCompatibility = { compatible: true; reason: null } | { compatible: false; reason: string };

const REMOTE_REPOSITORY_REASONS: Partial<Record<RepositoryBackend, string>> = {
	local: "Local repositories are only available to sources on this server.",
	rclone: "Rclone repositories use configuration on this server and are unavailable to remote sources.",
};

export const isRemoteSource = (volume: { agentId: string }) => volume.agentId !== BUILT_IN_LOCAL_AGENT_ID;

export const getBackupRepositoryCompatibility = (
	volume: { agentId: string },
	repositoryType: RepositoryBackend,
): BackupRepositoryCompatibility => {
	const reason = isRemoteSource(volume) ? REMOTE_REPOSITORY_REASONS[repositoryType] : undefined;

	return reason ? { compatible: false, reason } : { compatible: true, reason: null };
};
