import { Data, Effect, Runtime } from "effect";
import { createAgentMessage, type BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import type { Volume, VolumeExecutionSource } from "@zerobyte/contracts/volumes";
import { createBackupOptions, runBackupLifecycle } from "@zerobyte/core/backup-hooks";
import { logger } from "@zerobyte/core/node";
import { createRestic } from "@zerobyte/core/restic/server";
import { toErrorDetails, toMessage } from "@zerobyte/core/utils";
import type { ControllerCommandContext } from "../context";
import { getAgentExecutionPolicy } from "../execution-policy";
import { resticDeps } from "../restic/deps";
import { resolveTrustedBackupSelection } from "../trusted-backup-selection";
import { createVolumeBackend } from "../volume-host";

class VolumeReadinessError extends Data.TaggedError("VolumeReadinessError")<{
	readonly _tag: "VolumeReadinessError";
	message: string;
}> {}

const ensureHealthyVolume = (volume: Volume) =>
	Effect.gen(function* () {
		const backend = createVolumeBackend(volume);

		if (volume.type === "directory") {
			const health = yield* Effect.promise(() => backend.checkHealth());

			if (health.status !== "mounted") {
				const message = health.error ?? "Directory is not accessible";
				return yield* new VolumeReadinessError({ message });
			}
			return;
		}

		if (volume.status === "unmounted") {
			return yield* new VolumeReadinessError({
				message: `Volume ${volume.name} is not mounted`,
			});
		}

		let failureReason = volume.lastError ?? "Volume health check failed";

		if (volume.status !== "error") {
			const health = yield* Effect.promise(() => backend.checkHealth());
			if (health.status === "mounted") {
				return;
			}

			failureReason = health.error ?? failureReason;
		}

		if (!volume.autoRemount) {
			return yield* new VolumeReadinessError({ message: failureReason });
		}

		logger.warn(
			`${volume.name} is not healthy. Auto-remount is enabled, attempting to remount. Reason: ${failureReason}`,
		);

		const remount = yield* Effect.promise(() => backend.mount());

		if (remount.status !== "mounted") {
			return yield* new VolumeReadinessError({ message: remount.error ?? failureReason });
		}
	});

const resolveBackupSource = (context: ControllerCommandContext, source: VolumeExecutionSource) =>
	Effect.gen(function* () {
		const executionPolicy = getAgentExecutionPolicy(context);

		const resolved = yield* Effect.try({
			try: () => executionPolicy.resolveExecutionSource(source, "backup.run"),
			catch: (error) => new VolumeReadinessError({ message: toMessage(error) }),
		});

		if (source.kind === "managed") {
			yield* ensureHealthyVolume(source.volume);
		}

		return {
			sourcePath: resolved.canonicalPath,
			containmentRootPath: resolved.containmentRootPath,
			presentation: resolved.presentation,
		};
	});

export const handleBackupRunCommand = (context: ControllerCommandContext, payload: BackupRunPayload) => {
	let formatControllerError = toErrorDetails;
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

				const resolvedSource = yield* resolveBackupSource(context, payload.source);
				const sourcePath = resolvedSource.sourcePath;
				const containmentRootPath = resolvedSource.containmentRootPath;
				const presentation = resolvedSource.presentation;

				formatControllerError = presentation?.formatError ?? toErrorDetails;

				const dependencies = resticDeps(payload.runtime.password);

				const restic = yield* Effect.try({
					try: () => createRestic(dependencies),
					catch: (error) => error,
				});

				const options = yield* Effect.try({
					try: () => createBackupOptions(payload, sourcePath, abortController.signal),
					catch: (error) => error,
				});

				let lifecycleRestic: {
					backup: (...args: Parameters<typeof restic.backup>) => ReturnType<typeof restic.backup>;
				} = restic;

				if (payload.source.kind === "agent-filesystem") {
					lifecycleRestic = {
						backup: (repositoryConfig, backupSourcePath, resticOptions) => {
							const selectionSignal = resticOptions.signal ?? abortController.signal;
							return Effect.tryPromise({
								try: () =>
									resolveTrustedBackupSelection(
										resticOptions,
										backupSourcePath,
										containmentRootPath,
										selectionSignal,
									),
								catch: (error) => new Error(toMessage(error)),
							}).pipe(
								Effect.flatMap((selection) => {
									const selectedOptions = {
										...resticOptions,
										includePaths: selection.includePaths,
										includePatterns: undefined,
									};
									return restic.backup(repositoryConfig, backupSourcePath, selectedOptions);
								}),
							);
						},
					};
				}

				const backupResult = yield* runBackupLifecycle({
					restic: lifecycleRestic,
					repositoryConfig: payload.repositoryConfig,
					sourcePath,
					presentationSourcePath: presentation?.sourcePath,
					jobId: payload.jobId,
					scheduleId: payload.scheduleId,
					organizationId: payload.organizationId,
					options,
					webhooks: payload.webhooks,
					webhookAllowedOrigins: payload.webhookAllowedOrigins,
					webhookTimeoutMs: payload.webhookTimeoutMs,
					signal: abortController.signal,
					formatError: formatControllerError,
					onProgress: (progress) => {
						const controllerProgress = presentation ? presentation.formatProgress(progress) : progress;
						void Runtime.runPromise(
							runtime,
							context.offerOutbound(
								createAgentMessage("backup.progress", {
									jobId: payload.jobId,
									scheduleId: payload.scheduleId,
									progress: controllerProgress,
								}),
							),
						).catch((error) => {
							logger.error(`Failed to send backup progress update: ${toMessage(error)}`);
						});
					},
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
					const errorDetails = formatControllerError(error);
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
