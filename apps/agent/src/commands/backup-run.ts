import { Effect, Runtime } from "effect";
import { createAgentMessage, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { runBackupLifecycle } from "@zerobyte/core/backup-hooks";
import { logger } from "@zerobyte/core/node";
import { toErrorDetails, toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";
import { prepareBackupExecution } from "../backup-execution";

export const handleBackupRunCommand = (context: ControllerCommandContext, payload: BackupRunPayload) => {
	return Effect.gen(function* () {
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

		yield* logger.effect.info(`Starting backup ${payload.jobId} for schedule ${payload.scheduleId}`);

		const abortController = new AbortController();

		yield* context.setRunningJob(payload.jobId, {
			kind: "backup",
			scheduleId: payload.scheduleId,
			abortController,
		});

		yield* Effect.fork(
			Effect.gen(function* () {
				const sendCancelled = (message?: string) => {
					return context.offerOutbound(
						createAgentMessage("backup.cancelled", {
							jobId: payload.jobId,
							scheduleId: payload.scheduleId,
							message: message ?? "Backup was cancelled",
						}),
					);
				};

				yield* context.offerOutbound(
					createAgentMessage("backup.started", {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
					}),
				);

				const runtime = yield* Effect.runtime<never>();

				const execution = yield* prepareBackupExecution(
					context.trustedRoots,
					payload,
					abortController.signal,
					(progress) => {
						void Runtime.runPromise(
							runtime,
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
				);

				const backupResult = yield* runBackupLifecycle({
					...execution,
					jobId: payload.jobId,
					scheduleId: payload.scheduleId,
					organizationId: payload.organizationId,
					webhooks: payload.webhooks,
					webhookAllowedOrigins: payload.webhookAllowedOrigins,
					webhookTimeoutMs: payload.webhookTimeoutMs,
					signal: abortController.signal,
				});

				switch (backupResult.status) {
					case "completed":
						yield* context.offerOutbound(
							createAgentMessage("backup.completed", {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								exitCode: backupResult.exitCode,
								result: backupResult.result,
								warningDetails: backupResult.warningDetails ?? undefined,
							}),
						);
						return;
					case "failed":
						yield* context.offerOutbound(
							createAgentMessage("backup.failed", {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								error: toMessage(backupResult.error),
								errorDetails: backupResult.error,
							}),
						);
						return;
					case "cancelled":
						yield* sendCancelled(backupResult.message);
						return;
				}
			}).pipe(
				Effect.catchAll((error) => {
					if (abortController.signal.aborted) {
						return context.offerOutbound(
							createAgentMessage("backup.cancelled", {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								message: "Backup was cancelled",
							}),
						);
					}

					const errorDetails = toErrorDetails(error);

					return context.offerOutbound(
						createAgentMessage("backup.failed", {
							jobId: payload.jobId,
							scheduleId: payload.scheduleId,
							error: errorDetails,
							errorDetails,
						}),
					);
				}),
				Effect.ensuring(context.deleteRunningJob(payload.jobId)),
			),
		);
	}).pipe(Effect.asVoid);
};
