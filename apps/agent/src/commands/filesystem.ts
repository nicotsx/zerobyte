import { Effect, Data } from "effect";
import {
	createAgentMessage,
	type FilesystemCommand,
	type FilesystemCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import { toMessage } from "@zerobyte/core/utils";
import { browseFilesystem, listFiles, getStatFs } from "@zerobyte/core/filesystem";
import type { ControllerCommandContext } from "../context";
import { normalizeTrustedRelativePath, resolveFilesystemSource } from "../trusted-roots";
import { relativeFilesystemPath, reportSourceError } from "../filesystem-paths";

class FilesystemCommandError extends Data.TaggedError("FilesystemCommandError")<{
	cause: unknown;
}> {}

const executeFilesystemCommand = (context: ControllerCommandContext, command: FilesystemCommand) =>
	Effect.gen(function* () {
		const resolved = yield* Effect.tryPromise({
			try: () => resolveFilesystemSource(context.trustedRoots, command.source),
			catch: (cause) => new FilesystemCommandError({ cause }),
		});

		return yield* Effect.tryPromise({
			try: async () => {
				switch (command.name) {
					case "filesystem.statfs":
						return { name: command.name, result: await getStatFs(resolved.canonicalPath) };
					case "filesystem.listFiles": {
						const subPath = normalizeTrustedRelativePath((command.subPath ?? "").replace(/^\/+/, ""));

						return {
							name: command.name,
							result: await listFiles(resolved.canonicalPath, subPath, command.offset, command.limit),
						};
					}
					case "filesystem.browse": {
						const result = await browseFilesystem(resolved.canonicalPath);

						return {
							name: command.name,
							result: {
								...result,
								path: relativeFilesystemPath(resolved.containmentRootPath, result.path),
								directories: result.directories.map((directory) => ({
									...directory,
									path: relativeFilesystemPath(resolved.containmentRootPath, directory.path),
								})),
							},
						};
					}
				}
			},
			catch: (error) => new FilesystemCommandError({ cause: reportSourceError(error) }),
		});
	});

export const handleFilesystemCommand = (context: ControllerCommandContext, payload: FilesystemCommandPayload) => {
	return Effect.gen(function* () {
		const command = yield* executeFilesystemCommand(context, payload.command);

		yield* context.offerOutbound(
			createAgentMessage("filesystem.commandResult", {
				commandId: payload.commandId,
				status: "success",
				command,
			}),
		);

		return command;
	}).pipe(
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
};
