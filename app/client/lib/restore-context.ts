import { BUILT_IN_LOCAL_AGENT_ID } from "@zerobyte/contracts/backup-context";
import { findCommonAncestor, isPathWithin } from "@zerobyte/core/utils";
import type { RestoreMachine, Snapshot, Volume } from "./types";
import { getVolumeMountPath } from "./volume-path";

/** Name of the machine a restore runs on, or null when this server runs it. */
export const getRestoreMachineName = (machine: RestoreMachine) =>
	machine.agentId === BUILT_IN_LOCAL_AGENT_ID ? null : (machine.name ?? "the selected machine");

/** The snapshot source's machine when the snapshot can be restored there, otherwise the machine storing the repository. */
export const getDefaultRestoreMachine = (machines: RestoreMachine[], volume: Volume | undefined) =>
	machines.find((machine) => machine.agentId === volume?.agentId) ?? machines[0];

export const getSnapshotBrowsePaths = (snapshot: Pick<Snapshot, "paths">, volume: Volume | undefined) => {
	const hasNonPosixPaths = snapshot.paths.some((path) => !path.startsWith("/"));

	return {
		queryBasePath: hasNonPosixPaths ? "/" : findCommonAncestor(snapshot.paths),
		// Remote filesystem sources have no mount path on this server; their machine checks original locations against its trusted roots.
		displayBasePath: volume ? getVolumeMountPath(volume) : undefined,
	};
};

export const getOriginalLocationUnavailableReason = (
	snapshot: Pick<Snapshot, "paths">,
	volume: Volume | undefined,
	machine: RestoreMachine,
) => {
	const hasNonPosixPaths = snapshot.paths.some((path) => !path.startsWith("/"));
	const { queryBasePath, displayBasePath } = getSnapshotBrowsePaths(snapshot, volume);

	const machineName = getRestoreMachineName(machine);
	const restoreHint = machineName
		? `Restore it to a folder on ${machineName} instead.`
		: "Restore it to a custom location, or download it instead.";

	if (!volume || volume.agentId !== machine.agentId) {
		return machineName
			? `This snapshot's source is not on ${machineName}. Restore the files to a folder on ${machineName} instead.`
			: "This snapshot's source is not on this server. Restore the files to a folder on this server, or download them.";
	}
	if (hasNonPosixPaths || (displayBasePath && !isPathWithin(displayBasePath, queryBasePath))) {
		const source = machineName
			? `the source on ${machineName}`
			: "this Zerobyte server or the current linked volume";
		return `This snapshot was created from source paths that do not match ${source}. Restoring to the original location is unavailable. ${restoreHint}`;
	}
	if (volume.config?.readOnly) {
		return `The volume backing this backup is mounted read-only. Restoring to the original location is unavailable. ${restoreHint}`;
	}

	return null;
};
