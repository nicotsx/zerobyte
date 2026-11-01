import { Effect } from "effect";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { runBackupLifecycle } from "@zerobyte/core/backup-hooks";
import { logger } from "@zerobyte/core/node";
import { toErrorDetails, toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";
import { prepareBackupExecution } from "../backup-execution";

export const handleBackupRunCommand = (context: ControllerCommandContext, payload: BackupRunPayload) => {
	return Effect.gen(function* () {
		const existing = yield* context.getRunningJob(payload.jobId);

		if (existing) {
			yield* context.offerOutbound({
				type: "backup.failed",
				payload: {
					jobId: payload.jobId,
					scheduleId: payload.scheduleId,
					error: "Backup job is already running",
				},
			});
			return;
		}

		yield* logger.effect.info(`Starting backup ${payload.jobId} for schedule ${payload.scheduleId}`);

		const abortController = new AbortController();

		yield* context.setRunningJob(payload.jobId, {
			kind: "backup",
			scheduleId: payload.scheduleId,
			abortController,
		});

		yield* Effect.forkChild(
			Effect.gen(function* () {
				const sendCancelled = (message?: string) => {
					return context.offerOutbound({
						type: "backup.cancelled",
						payload: {
							jobId: payload.jobId,
							scheduleId: payload.scheduleId,
							message: message ?? "Backup was cancelled",
						},
					});
				};

				yield* context.offerOutbound({
					type: "backup.started",
					payload: {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
					},
				});

				const services = yield* Effect.context<never>();

				const execution = yield* prepareBackupExecution(
					context,
					payload,
					abortController.signal,
					(progress) => {
						void Effect.runPromiseWith(services)(
							context.offerOutbound({
								type: "backup.progress",
								payload: {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
									progress,
								},
							}),
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
						yield* context.offerOutbound({
							type: "backup.completed",
							payload: {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								exitCode: backupResult.exitCode,
								result: backupResult.result,
								warningDetails: backupResult.warningDetails ?? undefined,
							},
						});
						return;
					case "failed":
						yield* context.offerOutbound({
							type: "backup.failed",
							payload: {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								error: toMessage(backupResult.error),
								errorDetails: backupResult.error,
							},
						});
						return;
					case "cancelled":
						yield* sendCancelled(backupResult.message);
						return;
				}
			}).pipe(
				Effect.catch((error) => {
					if (abortController.signal.aborted) {
						return context.offerOutbound({
							type: "backup.cancelled",
							payload: {
								jobId: payload.jobId,
								scheduleId: payload.scheduleId,
								message: "Backup was cancelled",
							},
						});
					}

					const errorDetails = toErrorDetails(error);

					return context.offerOutbound({
						type: "backup.failed",
						payload: {
							jobId: payload.jobId,
							scheduleId: payload.scheduleId,
							error: errorDetails,
							errorDetails,
						},
					});
				}),
				Effect.ensuring(context.deleteRunningJob(payload.jobId)),
			),
		);
	}).pipe(Effect.asVoid);
};
