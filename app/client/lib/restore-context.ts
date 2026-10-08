import { isRemoteSource } from "@zerobyte/contracts/backup-context";
import { findCommonAncestor, isPathWithin } from "@zerobyte/core/utils";
import type { Snapshot, Volume } from "./types";
import { getVolumeMountPath } from "./volume-path";

export const getRestoreContext = (snapshot: Pick<Snapshot, "paths">, volume?: Volume) => {
	const hasNonPosixPaths = snapshot.paths.some((path) => !path.startsWith("/"));
	const queryBasePath = hasNonPosixPaths ? "/" : findCommonAncestor(snapshot.paths);
	const displayBasePath = volume ? getVolumeMountPath(volume) : undefined;

	let originalLocationUnavailableReason: string | null = null;
	if (!volume || isRemoteSource(volume)) {
		originalLocationUnavailableReason =
			"This snapshot's source is not on this server. Restore the files to a folder on this server, or download them.";
	} else if (hasNonPosixPaths || (displayBasePath && !isPathWithin(displayBasePath, queryBasePath))) {
		originalLocationUnavailableReason =
			"This snapshot was created from source paths that do not match this Zerobyte server or the current linked volume. Restoring to the original location is unavailable. Restore it to a custom location, or download it instead.";
	} else if (volume.config?.readOnly) {
		originalLocationUnavailableReason =
			"The volume backing this backup is mounted read-only. Restoring to the original location is unavailable. Restore it to a custom location, or download it instead.";
	}

	return { queryBasePath, displayBasePath, originalLocationUnavailableReason };
};
