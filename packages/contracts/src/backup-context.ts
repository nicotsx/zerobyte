import type { RepositoryBackend } from "@zerobyte/core/restic";

export const BUILT_IN_LOCAL_AGENT_ID = "local";

export type BackupSource = { kind: "managed" } | { kind: "agent-filesystem"; agentKind: "local" | "remote" };

export type BackupRepositoryCompatibility = { compatible: true; reason: null } | { compatible: false; reason: string };

const REMOTE_REPOSITORY_REASONS: Partial<Record<RepositoryBackend, string>> = {
	local: "Local repositories are only available to sources on this server.",
	rclone: "Rclone repositories use configuration on this server and are unavailable to remote sources.",
};

export const getBackupRepositoryCompatibility = (
	source: BackupSource,
	repositoryType: RepositoryBackend,
): BackupRepositoryCompatibility => {
	const isLocalSource = source.kind === "managed" || source.agentKind === "local";
	if (isLocalSource) {
		return { compatible: true, reason: null };
	}

	const reason = REMOTE_REPOSITORY_REASONS[repositoryType];
	if (reason) {
		return { compatible: false, reason };
	}

	return { compatible: true, reason: null };
};
