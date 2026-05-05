import { Effect } from "effect";
import {
	createAgentMessage,
	type VolumeCommand,
	type VolumeCommandPayload,
	type VolumeCommandResult,
} from "@zerobyte/contracts/agent-protocol";
import { toMessage } from "@zerobyte/core/utils";
import { createVolumeBackend, getStatFs, getVolumePath, type AgentVolume, type BackendConfig } from "../volume-host";
import { browseFilesystem, listVolumeFiles, testVolumeConnection } from "../volume-host/operations";
import type { ControllerCommandContext } from "../context";

type VolumeBackedCommand = Extract<VolumeCommand, { volume: unknown }>;

const asVolume = (volume: VolumeBackedCommand["volume"]): AgentVolume => ({
	...volume,
	config: volume.config as BackendConfig,
	provisioningId: volume.provisioningId ?? null,
});

const runBackendOperation = async (
	command: Extract<VolumeCommand, { volume: unknown }>,
	operation: "mount" | "unmount" | "checkHealth",
) => {
	const backend = createVolumeBackend(asVolume(command.volume));
	return backend[operation]();
};

const executeVolumeCommand = async (command: VolumeCommand): Promise<VolumeCommandResult> => {
	switch (command.name) {
		case "volume.mount":
			return { name: command.name, result: await runBackendOperation(command, "mount") };
		case "volume.unmount":
			return { name: command.name, result: await runBackendOperation(command, "unmount") };
		case "volume.checkHealth":
			return { name: command.name, result: await runBackendOperation(command, "checkHealth") };
		case "volume.statfs":
			return { name: command.name, result: await getStatFs(getVolumePath(asVolume(command.volume))) };
		case "volume.listFiles":
			return {
				name: command.name,
				result: await listVolumeFiles(asVolume(command.volume), command.subPath, command.offset, command.limit),
			};
		case "volume.testConnection":
			return { name: command.name, result: await testVolumeConnection(command.backendConfig as BackendConfig) };
		case "filesystem.browse":
			return { name: command.name, result: await browseFilesystem(command.path) };
	}
};

export const handleVolumeCommand = (context: ControllerCommandContext, payload: VolumeCommandPayload) => {
	return Effect.promise(async () => {
		try {
			const command = await executeVolumeCommand(payload.command);
			await Effect.runPromise(
				context.offerOutbound(
					createAgentMessage("volume.commandResult", {
						commandId: payload.commandId,
						status: "success",
						command,
					}),
				),
			);
		} catch (error) {
			await Effect.runPromise(
				context.offerOutbound(
					createAgentMessage("volume.commandResult", {
						commandId: payload.commandId,
						status: "error",
						error: toMessage(error),
					}),
				),
			);
		}
	});
};
