import { Effect } from "effect";
import { createAgentMessage, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { logger } from "@zerobyte/core/node";
import { type ResticDeps } from "@zerobyte/core/restic";
import { createRestic } from "@zerobyte/core/restic/server";
import { toErrorDetails, toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";

export const handleBackupRunCommand = (context: ControllerCommandContext, payload: BackupRunPayload) =>
	Effect.fork(
		Effect.gen(function* () {
			const existing = yield* context.getRunningJob(payload.jobId);
			if (existing) {
				yield* context.offerOutbound(
					createAgentMessage("backup.failed", {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
						error: "Backup job is already running",
					}),
				);
				return;
			}

			logger.info(`Starting backup ${payload.jobId} for schedule ${payload.scheduleId}`);
			const abortController = new AbortController();
			yield* context.setRunningJob(payload.jobId, { scheduleId: payload.scheduleId, abortController });

			const sendCancelled = () => {
				return context.offerOutbound(
					createAgentMessage("backup.cancelled", {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
						message: "Backup was cancelled",
					}),
				);
			};

			yield* context.offerOutbound(
				createAgentMessage("backup.started", {
					jobId: payload.jobId,
					scheduleId: payload.scheduleId,
				}),
			);

			const deps: ResticDeps = {
				resolveSecret: async (encrypted) => encrypted,
				getOrganizationResticPassword: async () => payload.runtime.password,
				resticCacheDir: payload.runtime.cacheDir,
				resticPassFile: payload.runtime.passFile,
				defaultExcludes: payload.runtime.defaultExcludes,
				hostname: payload.runtime.hostname,
			};

			const restic = createRestic(deps);

			yield* restic
				.backup(payload.repositoryConfig, payload.sourcePath, {
					organizationId: payload.organizationId,
					...payload.options,
					signal: abortController.signal,
					onProgress: (progress) => {
						void Effect.runPromise(
							context.offerOutbound(
								createAgentMessage("backup.progress", {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
									progress,
								}),
							),
						).catch((error) => {
							logger.error(`Failed to send backup progress update: ${toMessage(error)}`);
						});
					},
				})
				.pipe(
					Effect.matchEffect({
						onSuccess: (result) => {
							if (abortController.signal.aborted) {
								return sendCancelled();
							}

							return context.offerOutbound(
								createAgentMessage("backup.completed", {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
									exitCode: result.exitCode,
									result: result.result,
									warningDetails: result.warningDetails ?? undefined,
								}),
							);
						},
						onFailure: (error) => {
							if (abortController.signal.aborted) {
								return sendCancelled();
							}

							return context.offerOutbound(
								createAgentMessage("backup.failed", {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
									error: toMessage(error),
									errorDetails: toErrorDetails(error),
								}),
							);
						},
					}),
					Effect.ensuring(context.deleteRunningJob(payload.jobId)),
				);
		}),
	).pipe(Effect.asVoid);
