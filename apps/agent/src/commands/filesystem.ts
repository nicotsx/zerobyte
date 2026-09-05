import { Data, Effect } from "effect";
import {
	createAgentMessage,
	type FilesystemCommand,
	type FilesystemCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import { browseFilesystem, listFiles, getStatFs } from "@zerobyte/core/filesystem";
import { toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";

class FilesystemCommandError extends Data.TaggedError("FilesystemCommandError")<{ cause: unknown }> {}

const executeFilesystemCommand = async (command: FilesystemCommand) => {
	switch (command.name) {
		case "filesystem.statfs":
			return { name: command.name, result: await getStatFs(command.path) };
		case "filesystem.listFiles":
			return {
				name: command.name,
				result: await listFiles(command.path, command.subPath, command.offset, command.limit),
			};
		case "filesystem.browse":
			return { name: command.name, result: await browseFilesystem(command.path) };
	}
};

export const handleFilesystemCommand = (context: ControllerCommandContext, payload: FilesystemCommandPayload) =>
	Effect.tryPromise({
		try: () => executeFilesystemCommand(payload.command),
		catch: (cause) => new FilesystemCommandError({ cause }),
	}).pipe(
		Effect.flatMap((command) =>
			context.offerOutbound(
				createAgentMessage("filesystem.commandResult", {
					commandId: payload.commandId,
					status: "success",
					command,
				}),
			),
		),
		Effect.catchAll((error) =>
			context.offerOutbound(
				createAgentMessage("filesystem.commandResult", {
					commandId: payload.commandId,
					status: "error",
					error: toMessage(error.cause),
				}),
			),
		),
	);
