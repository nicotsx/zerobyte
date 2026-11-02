import { isAgentRepository } from "@zerobyte/contracts/backup-context";
import { findCommonAncestor, isPathWithin } from "@zerobyte/core/utils";
import type { Repository, Snapshot, Volume } from "./types";
import { getVolumeMountPath } from "./volume-path";

type RestoreRepository = Pick<Repository, "agentId" | "agentName">;

/** Machine that runs restores of this repository, or null when this server runs them. */
export const getRestoreMachineName = (repository: RestoreRepository) =>
	isAgentRepository(repository) ? (repository.agentName ?? "the owning machine") : null;

export const getRestoreContext = (
	snapshot: Pick<Snapshot, "paths">,
	volume: Volume | undefined,
	repository: RestoreRepository,
) => {
	const hasNonPosixPaths = snapshot.paths.some((path) => !path.startsWith("/"));
	const queryBasePath = hasNonPosixPaths ? "/" : findCommonAncestor(snapshot.paths);
	// Remote filesystem sources have no mount path on this server; the owning machine checks original locations against its trusted roots.
	const displayBasePath = volume ? getVolumeMountPath(volume) : undefined;

	const machineName = getRestoreMachineName(repository);
	const restoreHint = machineName
		? `Restore it to a folder on ${machineName} instead.`
		: "Restore it to a custom location, or download it instead.";

	let originalLocationUnavailableReason: string | null = null;
	if (!volume || volume.agentId !== repository.agentId) {
		originalLocationUnavailableReason = machineName
			? `This snapshot's source is not on ${machineName}. Restore the files to a folder on ${machineName} instead.`
			: "This snapshot's source is not on this server. Restore the files to a folder on this server, or download them.";
	} else if (hasNonPosixPaths || (displayBasePath && !isPathWithin(displayBasePath, queryBasePath))) {
		const source = machineName
			? `the source on ${machineName}`
			: "this Zerobyte server or the current linked volume";
		originalLocationUnavailableReason = `This snapshot was created from source paths that do not match ${source}. Restoring to the original location is unavailable. ${restoreHint}`;
	} else if (volume.config?.readOnly) {
		originalLocationUnavailableReason = `The volume backing this backup is mounted read-only. Restoring to the original location is unavailable. ${restoreHint}`;
	}

	return { queryBasePath, displayBasePath, originalLocationUnavailableReason };
};
