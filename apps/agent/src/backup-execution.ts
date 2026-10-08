import { Effect } from "effect";
import type { BackupRunPayload } from "@zerobyte/contracts/agent-protocol";
import { createBackupOptions } from "@zerobyte/core/backup-hooks";
import type { ResticBackupProgressDto } from "@zerobyte/core/restic";
import { createRestic, resolveBackupTargets } from "@zerobyte/core/restic/server";
import { isResticError, ResticError } from "@zerobyte/core/restic";
import { logger } from "@zerobyte/core/node";
import { toErrorDetails } from "@zerobyte/core/utils";
import { normalizeTrustedRelativePath, resolveFilesystemSource } from "./trusted-roots";
import { relativeFilesystemPath } from "./filesystem-paths";
import type { ControllerCommandContext } from "./context";

const reportBackupError = (error: unknown) => {
	logger.error(toErrorDetails(error));

	return isResticError(error)
		? `${error.summary} Check the agent logs for details.`
		: "Backup failed. Check the agent logs for details.";
};

export const prepareBackupExecution = (
	context: Pick<ControllerCommandContext, "trustedRoots" | "resticDeps">,
	payload: BackupRunPayload,
	signal: AbortSignal,
	onProgress: (progress: ResticBackupProgressDto) => void,
) =>
	Effect.tryPromise({
		try: async () => {
			const source = await resolveFilesystemSource(context.trustedRoots, payload.source);
			const restic = createRestic(context.resticDeps(payload.runtime.password));
			const options = createBackupOptions(payload, source.canonicalPath, signal);

			return {
				sourcePath: normalizeTrustedRelativePath(payload.source.relativePath),
				runBackup: () =>
					Effect.gen(function* () {
						const includePaths = yield* Effect.tryPromise({
							try: () =>
								resolveBackupTargets(
									payload.options,
									source.canonicalPath,
									source.containmentRootPath,
									signal,
								),
							catch: (error) => error,
						});

						const result = yield* restic.backup(payload.repositoryConfig, source.canonicalPath, {
							...options,
							organizationId: payload.organizationId,
							includePaths,
							onProgress: (progress) =>
								onProgress({
									...progress,
									current_files: progress.current_files.map((file) =>
										relativeFilesystemPath(source.containmentRootPath, file),
									),
								}),
						});

						return {
							...result,
							warningDetails: result.warningDetails
								? reportBackupError(new ResticError(result.exitCode, result.warningDetails))
								: null,
						};
					}).pipe(Effect.mapError(reportBackupError)),
			};
		},
		catch: reportBackupError,
	});
