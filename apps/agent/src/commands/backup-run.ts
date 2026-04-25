import { Effect, Runtime } from "effect";
import { createAgentMessage, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { runBackupWithWebhooks } from "@zerobyte/core/backup-hooks";
import { logger } from "@zerobyte/core/node";
import { type ResticDeps } from "@zerobyte/core/restic";
import { createRestic } from "@zerobyte/core/restic/server";
import { toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";

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

		logger.info(`Starting backup ${payload.jobId} for schedule ${payload.scheduleId}`);
		const abortController = new AbortController();
		yield* context.setRunningJob(payload.jobId, { scheduleId: payload.scheduleId, abortController });

		yield* Effect.fork(
			Effect.gen(function* () {
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
					rcloneConfigFile: payload.runtime.rcloneConfigFile,
				};

				const restic = createRestic(deps);
				const runtime = yield* Effect.runtime<never>();

				const backupResult = yield* runBackupWithWebhooks({
					metadata: {
						jobId: payload.jobId,
						scheduleId: payload.scheduleId,
						organizationId: payload.organizationId,
						sourcePath: payload.sourcePath,
					},
					webhooks: payload.webhooks,
					signal: abortController.signal,
					runBackup: () =>
						restic.backup(payload.repositoryConfig, payload.sourcePath, {
							organizationId: payload.organizationId,
							...payload.options,
							signal: abortController.signal,
							onProgress: (progress) => {
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
						}).pipe(
							Effect.map((result) => ({
								status: "completed" as const,
								exitCode: result.exitCode,
								result: result.result,
								warningDetails: result.warningDetails,
							})),
						),
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
								error: backupResult.error,
								errorDetails: backupResult.error,
							}),
						);
						return;
					case "cancelled":
						yield* sendCancelled();
						return;
				}
			}).pipe(Effect.ensuring(context.deleteRunningJob(payload.jobId))),
		);
	}).pipe(Effect.asVoid);
};
