import { Effect, Queue } from "effect";
import {
	createAgentMessage,
	RESTIC_COMMAND_RESULT_CHUNK_SIZE,
	type ResticCommandPayload,
} from "@zerobyte/contracts/agent-protocol";
import { createRestic } from "@zerobyte/core/restic/server";
import { isResticError, type ResticDeps } from "@zerobyte/core/restic";
import { logger } from "@zerobyte/core/node";
import { toErrorDetails, toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";
import { resolveRepositoryConfig, type TrustedRootRegistry } from "../trusted-roots";

const runResticCommand = (
	deps: ResticDeps,
	payload: ResticCommandPayload,
	signal: AbortSignal,
	onMessage: (message: string) => void,
) => {
	const restic = createRestic(deps);
	const { organizationId, repositoryConfig, command } = payload;

	switch (command.name) {
		case "restic.init":
			return restic.init(repositoryConfig, { organizationId, timeoutMs: command.timeoutMs });
		case "restic.snapshots":
			return restic.snapshots(repositoryConfig, { organizationId, tags: command.tags, signal });
		case "restic.ls":
			return restic.ls(repositoryConfig, command.snapshotId, command.path, {
				organizationId,
				offset: command.offset,
				limit: command.limit,
			});
		case "restic.check":
			return restic.check(repositoryConfig, { organizationId, readData: command.readData, signal });
		case "restic.forget":
			return restic.forget(repositoryConfig, command.retentionPolicy, {
				organizationId,
				tag: command.tag,
				dryRun: command.dryRun,
				signal,
			});
		case "restic.deleteSnapshots":
			return restic.deleteSnapshots(repositoryConfig, command.snapshotIds, { organizationId });
		case "restic.tagSnapshots":
			return restic.tagSnapshots(repositoryConfig, command.snapshotIds, command.tags, { organizationId });
		case "restic.unlock":
			return restic.unlock(repositoryConfig, { organizationId, removeAll: command.removeAll, signal });
		case "restic.repairIndex":
			return restic.repairIndex(repositoryConfig, { organizationId, signal });
		case "restic.stats":
			return restic.stats(repositoryConfig, { organizationId });
		case "restic.copy":
			return restic.copy(repositoryConfig, command.destinationConfig, {
				organizationId,
				tag: command.tag,
				snapshotIds: command.snapshotIds,
				customResticParams: command.customResticParams,
				signal,
				onMessage,
			});
	}
};

const resolveCommandRepositories = async (
	registry: TrustedRootRegistry,
	payload: ResticCommandPayload,
): Promise<ResticCommandPayload> => {
	const repositoryConfig = await resolveRepositoryConfig(registry, payload.repositoryConfig);

	if (payload.command.name === "restic.copy") {
		const destinationConfig = await resolveRepositoryConfig(registry, payload.command.destinationConfig);
		return { ...payload, repositoryConfig, command: { ...payload.command, destinationConfig } };
	}

	return { ...payload, repositoryConfig };
};

const toResticFailure = (error: unknown) => {
	if (isResticError(error)) {
		return { error: error.summary, resticExitCode: error.code, details: error.details };
	}

	return { error: toMessage(error) };
};

/**
 * Splits the JSON result into fixed-size chunks so each message stays well below the controller's inbound limit.
 * The final piece is returned separately because it travels in the terminal "success" message. Chunk boundaries never
 * separate a UTF-16 surrogate pair, since a lone surrogate would not survive UTF-8 encoding of the message.
 */
const splitResult = (result: unknown) => {
	const serialized = JSON.stringify(result === undefined ? null : result);
	const pieces: string[] = [];

	let offset = 0;
	while (offset < serialized.length) {
		let end = Math.min(offset + RESTIC_COMMAND_RESULT_CHUNK_SIZE, serialized.length);
		const lastCode = serialized.charCodeAt(end - 1);

		if (end < serialized.length && lastCode >= 0xd800 && lastCode <= 0xdbff) {
			end -= 1;
		}

		pieces.push(serialized.slice(offset, end));
		offset = end;
	}

	const data = pieces.pop() ?? "";
	return { chunks: pieces, data };
};

const whenAborted = (signal: AbortSignal) =>
	Effect.callback<never, Error>((resume) => {
		const onAbort = () => resume(Effect.fail(new Error("Restic command was cancelled")));

		if (signal.aborted) return onAbort();

		signal.addEventListener("abort", onAbort, { once: true });
		return Effect.sync(() => signal.removeEventListener("abort", onAbort));
	});

export const handleResticCommand = (context: ControllerCommandContext, payload: ResticCommandPayload) => {
	return Effect.gen(function* () {
		const { commandId } = payload;

		const existing = yield* context.getRunningJob(commandId);
		if (existing) {
			yield* context.offerOutbound(
				createAgentMessage("restic.commandResult", {
					commandId,
					status: "error",
					error: "Restic command is already running",
				}),
			);
			return;
		}

		const abortController = new AbortController();
		const resultAcks = yield* Queue.unbounded<void>();
		yield* context.setRunningJob(commandId, { kind: "restic", abortController, resultAcks });

		// Restic commands can run for hours; executing them off the session processor keeps restic.cancel responsive.
		yield* Effect.forkChild(
			Effect.gen(function* () {
				const services = yield* Effect.context<never>();

				const resolvedPayload = yield* Effect.tryPromise({
					try: () => resolveCommandRepositories(context.trustedRoots, payload),
					catch: (error) => error,
				});

				const result = yield* runResticCommand(
					context.resticDeps(payload.runtime.password),
					resolvedPayload,
					abortController.signal,
					(message) => {
						void Effect.runPromiseWith(services)(
							context.offerOutbound(createAgentMessage("restic.commandMessage", { commandId, message })),
						).catch((error) => {
							logger.error(`Failed to send restic command message: ${toMessage(error)}`);
						});
					},
				);

				const { chunks, data } = splitResult(result);

				for (const chunk of chunks) {
					yield* context.offerOutbound(
						createAgentMessage("restic.commandResult", { commandId, status: "chunk", data: chunk }),
					);
					yield* Queue.take(resultAcks).pipe(Effect.raceFirst(whenAborted(abortController.signal)));
				}

				yield* context.offerOutbound(
					createAgentMessage("restic.commandResult", { commandId, status: "success", data }),
				);
			}).pipe(
				Effect.catch((error) => {
					if (abortController.signal.aborted) {
						return context.offerOutbound(
							createAgentMessage("restic.commandResult", {
								commandId,
								status: "error",
								error: "Restic command was cancelled",
							}),
						);
					}

					logger.error(toErrorDetails(error));

					return context.offerOutbound(
						createAgentMessage("restic.commandResult", {
							commandId,
							status: "error",
							...toResticFailure(error),
						}),
					);
				}),
				Effect.ensuring(context.deleteRunningJob(commandId)),
			),
		);
	}).pipe(Effect.asVoid);
};
