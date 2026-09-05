import { Effect, Data } from "effect";
import { createAgentMessage, type VolumeCommand, type VolumeCommandPayload } from "@zerobyte/contracts/agent-protocol";
import { toMessage } from "@zerobyte/core/utils";
import { createVolumeBackend, getStatFs } from "../volume-host";
import { browseFilesystem, listVolumeFiles, testVolumeConnection } from "../volume-host/operations";
import type { ControllerCommandContext } from "../context";
import { getAgentExecutionPolicy } from "../execution-policy";

class VolumeCommandError extends Data.TaggedError("StopAgentManagerServerError")<{
	cause: unknown;
}> {}

const runBackendOperation = (
	command: Extract<VolumeCommand, { volume: unknown }>,
	operation: "mount" | "unmount" | "checkHealth",
) =>
	Effect.tryPromise({
		try: () => {
			const backend = createVolumeBackend(command.volume);
			return backend[operation]();
		},
		catch: (error) => new VolumeCommandError({ cause: error }),
	});

const enforcePolicy = <Result>(assertion: () => Result) =>
	Effect.try({
		try: assertion,
		catch: (error) => new VolumeCommandError({ cause: error }),
	});

const executeVolumeCommand = (context: ControllerCommandContext, command: VolumeCommand) =>
	Effect.gen(function* () {
		const executionPolicy = getAgentExecutionPolicy(context);

		switch (command.name) {
			case "volume.mount": {
				yield* enforcePolicy(() => executionPolicy.assertLocalOperation(command.name));
				return { name: command.name, result: yield* runBackendOperation(command, "mount") };
			}
			case "volume.unmount": {
				yield* enforcePolicy(() => executionPolicy.assertLocalOperation(command.name));
				return { name: command.name, result: yield* runBackendOperation(command, "unmount") };
			}
			case "volume.checkHealth": {
				yield* enforcePolicy(() => executionPolicy.assertLocalOperation(command.name));
				return { name: command.name, result: yield* runBackendOperation(command, "checkHealth") };
			}
			case "volume.statfs": {
				const source = command.source;
				const resolved = yield* enforcePolicy(() =>
					executionPolicy.resolveExecutionSource(source, command.name),
				);

				const result = yield* Effect.tryPromise({
					try: () => getStatFs(resolved.canonicalPath),
					catch: (error) => {
						const cause = resolved.presentation ? resolved.presentation.formatError(error) : error;
						return new VolumeCommandError({ cause });
					},
				});
				return { name: command.name, result };
			}
			case "volume.listFiles": {
				const source = command.source;
				const resolved = yield* enforcePolicy(() =>
					executionPolicy.resolveFileListingSource(source, command.subPath),
				);

				const result = yield* Effect.tryPromise({
					try: () => listVolumeFiles(resolved, command.offset, command.limit),
					catch: (error) => new VolumeCommandError({ cause: error }),
				});

				return { name: command.name, result };
			}
			case "volume.testConnection": {
				yield* enforcePolicy(() => executionPolicy.assertLocalOperation(command.name));
				const result = yield* testVolumeConnection(command.backendConfig);
				return { name: command.name, result };
			}
			case "filesystem.browse": {
				const reference = command.reference;
				if (!reference) {
					yield* enforcePolicy(() => executionPolicy.assertUnrestrictedLocalFilesystem(command.name));

					const legacyPath = command.path ?? "/";

					const result = yield* Effect.tryPromise({
						try: () => browseFilesystem(legacyPath),
						catch: (error) => new VolumeCommandError({ cause: error }),
					});
					return { name: command.name, result };
				}

				const resolved = yield* enforcePolicy(() =>
					executionPolicy.resolveTrustedReference(reference, command.name),
				);
				const browseRootPath = resolved.presentation.browseRootPath;

				const result = yield* Effect.tryPromise({
					try: () => browseFilesystem(resolved.canonicalPath, browseRootPath),
					catch: (error) => new VolumeCommandError({ cause: error }),
				});

				const controllerResult = resolved.presentation.formatBrowseResult(result);
				return { name: command.name, result: controllerResult };
			}
		}
	});

export const handleVolumeCommand = (context: ControllerCommandContext, payload: VolumeCommandPayload) => {
	return Effect.gen(function* () {
		const command = yield* executeVolumeCommand(context, payload.command);

		yield* context.offerOutbound(
			createAgentMessage("volume.commandResult", {
				commandId: payload.commandId,
				status: "success",
				command,
			}),
		);

		return command;
	}).pipe(
		Effect.catchAll((error) =>
			context.offerOutbound(
				createAgentMessage("volume.commandResult", {
					commandId: payload.commandId,
					status: "error",
					error: toMessage(error?.cause),
				}),
			),
		),
	);
};
