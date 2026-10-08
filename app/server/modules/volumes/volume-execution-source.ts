import { Effect } from "effect";
import { BadRequestError, ServiceUnavailableError } from "http-errors-enhanced";
import type { FilesystemCommand } from "@zerobyte/contracts/agent-protocol";
import type { FilesystemSource } from "@zerobyte/contracts/volumes";
import type { Volume } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { agentManager } from "../agents/agents-manager";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { getLocalFilesystemSource, getVolumePath } from "./helpers";

export const assembleVolumeExecutionSource = (volume: Volume): FilesystemSource => {
	if (volume.sourceKind === "filesystem") {
		return { rootId: volume.trustedRootId, relativePath: volume.relativePath };
	}
	if (volume.agentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError("Managed volume backends can only run on the built-in local agent");
	}

	return getLocalFilesystemSource(getVolumePath(volume));
};

export const runFilesystemCommand = <TCommand extends FilesystemCommand>(
	agentId: string,
	organizationId: string,
	command: TCommand,
) =>
	Effect.suspend(() => agentManager.runFilesystemCommand(agentId, organizationId, command)).pipe(
		Effect.mapError(
			(error) => new ServiceUnavailableError(`Filesystem source is unavailable: ${toMessage(error)}`),
		),
	);

export const probeSource = (agentId: string, organizationId: string, source: FilesystemSource) =>
	runFilesystemCommand(agentId, organizationId, { name: "filesystem.statfs", source }).pipe(
		Effect.map((command) => command.result),
	);
