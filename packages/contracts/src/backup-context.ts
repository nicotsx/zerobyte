import type { RepositoryBackend } from "@zerobyte/core/restic";

export const BUILT_IN_LOCAL_AGENT_ID = "local";

export type BackupRepositoryCompatibility = { compatible: true; reason: null } | { compatible: false; reason: string };

type RepositoryPlacement = { type: RepositoryBackend; agentId: string };

const REMOTE_REPOSITORY_REASONS: Partial<Record<RepositoryBackend, string>> = {
	local: "Local repositories are only available to sources on this server.",
	rclone: "Rclone repositories use configuration on this server and are unavailable to remote sources.",
};

export const AGENT_REPOSITORY_FOREIGN_SOURCE_REASON =
	"This repository is stored on another machine and only accepts backups from sources on that machine. To back up other machines to the same disk, expose it with rest-server or SFTP and add it as a REST or SFTP repository.";

export const isRemoteSource = (volume: { agentId: string }) => volume.agentId !== BUILT_IN_LOCAL_AGENT_ID;

/** A repository whose storage lives on a remote agent's machine; every restic command must run on that agent. */
export const isAgentRepository = (repository: { agentId: string }) => repository.agentId !== BUILT_IN_LOCAL_AGENT_ID;

export const getBackupRepositoryCompatibility = (
	volume: { agentId: string },
	repository: RepositoryPlacement,
): BackupRepositoryCompatibility => {
	if (isAgentRepository(repository)) {
		return volume.agentId === repository.agentId
			? { compatible: true, reason: null }
			: { compatible: false, reason: AGENT_REPOSITORY_FOREIGN_SOURCE_REASON };
	}

	const reason = isRemoteSource(volume) ? REMOTE_REPOSITORY_REASONS[repository.type] : undefined;

	return reason ? { compatible: false, reason } : { compatible: true, reason: null };
};

export type MirrorPlacement =
	{ compatible: true; agentId: string; reason: null } | { compatible: false; agentId: null; reason: string };

/**
 * `restic copy` reads both repositories from one process. Agent repositories are only reachable from their agent, so
 * the copy runs there and the other repository must be reachable from that machine too.
 */
export const getMirrorPlacement = (source: RepositoryPlacement, mirror: RepositoryPlacement): MirrorPlacement => {
	const sourceOnAgent = isAgentRepository(source);
	const mirrorOnAgent = isAgentRepository(mirror);

	if (!sourceOnAgent && !mirrorOnAgent) {
		return { compatible: true, agentId: BUILT_IN_LOCAL_AGENT_ID, reason: null };
	}

	if (sourceOnAgent && mirrorOnAgent) {
		return source.agentId === mirror.agentId
			? { compatible: true, agentId: source.agentId, reason: null }
			: {
					compatible: false,
					agentId: null,
					reason: "Repositories stored on different machines cannot mirror each other.",
				};
	}

	const agentRepository = sourceOnAgent ? source : mirror;
	const otherRepository = sourceOnAgent ? mirror : source;
	const reason = REMOTE_REPOSITORY_REASONS[otherRepository.type];

	return reason
		? {
				compatible: false,
				agentId: null,
				reason: `Repositories stored on another machine can only mirror with repositories that machine can reach. ${reason}`,
			}
		: { compatible: true, agentId: agentRepository.agentId, reason: null };
};
