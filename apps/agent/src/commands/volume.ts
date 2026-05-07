import { Effect, Data } from "effect";
import { createAgentMessage, type VolumeCommand, type VolumeCommandPayload } from "@zerobyte/contracts/agent-protocol";
import { toMessage } from "@zerobyte/core/utils";
import { createVolumeBackend, getStatFs, getVolumePath, type AgentVolume, type BackendConfig } from "../volume-host";
import { browseFilesystem, listVolumeFiles, testVolumeConnection } from "../volume-host/operations";
import type { ControllerCommandContext } from "../context";

type VolumeBackedCommand = Extract<VolumeCommand, { volume: unknown }>;

class VolumeCommandError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

const asVolume = (volume: VolumeBackedCommand["volume"]): AgentVolume => ({
	...volume,
	config: volume.config as BackendConfig,
	provisioningId: volume.provisioningId ?? null,
});

const runBackendOperation = (
	command: Extract<VolumeCommand, { volume: unknown }>,
	operation: "mount" | "unmount" | "checkHealth",
) =>
	Effect.tryPromise({
		try: () => {
			const backend = createVolumeBackend(asVolume(command.volume));
			return backend[operation]();
		},
		catch: (error) => new VolumeCommandError({ cause: error }),
	});

const executeVolumeCommand = (command: VolumeCommand) =>
	Effect.gen(function* () {
		switch (command.name) {
			case "volume.mount":
				return { name: command.name, result: yield* runBackendOperation(command, "mount") };
			case "volume.unmount":
				return { name: command.name, result: yield* runBackendOperation(command, "unmount") };
			case "volume.checkHealth":
				return { name: command.name, result: yield* runBackendOperation(command, "checkHealth") };
			case "volume.statfs": {
				const result = yield* Effect.tryPromise({
					try: () => getStatFs(getVolumePath(asVolume(command.volume))),
					catch: (error) => new VolumeCommandError({ cause: error }),
				});
				return { name: command.name, result };
			}
			case "volume.listFiles": {
				const result = yield* Effect.tryPromise({
					try: () => listVolumeFiles(asVolume(command.volume), command.subPath, command.offset, command.limit),
					catch: (error) => new VolumeCommandError({ cause: error }),
				});

				return { name: command.name, result };
			}
			case "volume.testConnection": {
				const result = yield* testVolumeConnection(command.backendConfig as BackendConfig);
				return { name: command.name, result };
			}
			case "filesystem.browse":
				const result = yield* Effect.tryPromise({
					try: () => browseFilesystem(command.path),
					catch: (error) => new VolumeCommandError({ cause: error }),
				});
				return { name: command.name, result };
		}
	});

export const handleVolumeCommand = (context: ControllerCommandContext, payload: VolumeCommandPayload) => {
	return Effect.gen(function* () {
		const command = yield* executeVolumeCommand(payload.command);

		yield* context.offerOutbound(
			createAgentMessage("volume.commandResult", {
				commandId: payload.commandId,
				status: "success",
				command,
			}),
		);

		return command;
	}).pipe(
		Effect.tapError((error) => {
			return context.offerOutbound(
				createAgentMessage("volume.commandResult", {
					commandId: payload.commandId,
					status: "error",
					error: toMessage(error?.cause),
				}),
			);
		}),
	);
};
