import os from "node:os";
import path from "node:path";
import { Effect, Runtime } from "effect";
import { createAgentMessage, type RestoreRunPayload } from "@zerobyte/contracts/agent-protocol";
import { createSnapshotPathContext } from "@zerobyte/core/restic";
import { createRestic } from "@zerobyte/core/restic/server";
import { isPathWithin, toMessage } from "@zerobyte/core/utils";
import { logger } from "@zerobyte/core/node";
import type { ControllerCommandContext } from "../context";
import { resticDeps } from "../restic/deps";

const REPOSITORY_BASE = process.env.ZEROBYTE_REPOSITORIES_DIR || "/var/lib/zerobyte/repositories";
const RESTIC_PASS_FILE = process.env.RESTIC_PASS_FILE || "/var/lib/zerobyte/data/restic.pass";

const getBlockedRestoreTargets = () =>
	[REPOSITORY_BASE, path.dirname(RESTIC_PASS_FILE), os.tmpdir()].map((target) => path.resolve(target));

const assertAllowedRestoreTarget = (target: string) => {
	const resolvedTarget = path.resolve(target);

	for (const blockedTarget of getBlockedRestoreTargets()) {
		if (isPathWithin(blockedTarget, resolvedTarget)) {
			throw new Error(
				"Restore target path is not allowed. Restoring to this path could overwrite critical system files or application data.",
			);
		}
	}
};

export const handleRestoreRunCommand = (context: ControllerCommandContext, payload: RestoreRunPayload) => {
	return Effect.gen(function* () {
		const restoreContext = {
			restoreId: payload.restoreId,
			organizationId: payload.organizationId,
			repositoryId: payload.repositoryId,
			snapshotId: payload.snapshotId,
		};

		const existing = yield* context.getRunningJob(payload.restoreId);
		if (existing) {
			yield* context.offerOutbound(
				createAgentMessage("restore.failed", {
					...restoreContext,
					error: "Restore job is already running",
				}),
			);
			return;
		}

		logger.info(`Starting restore ${payload.restoreId} for snapshot ${payload.snapshotId}`);
		const abortController = new AbortController();
		yield* context.setRunningJob(payload.restoreId, { kind: "restore", abortController });

		yield* Effect.fork(
			Effect.gen(function* () {
				const plan = createSnapshotPathContext({
					snapshotPaths: payload.snapshotPaths,
					targetPlatform: process.platform,
				}).restore.plan(payload.request);
				assertAllowedRestoreTarget(plan.target);

				const runtime = yield* Effect.runtime<never>();
				const restic = createRestic(resticDeps(payload.runtime.password));

				yield* context.offerOutbound(createAgentMessage("restore.started", restoreContext));

				const result = yield* restic.restore(payload.repositoryConfig, payload.snapshotId, plan.target, {
					...plan.options,
					organizationId: payload.organizationId,
					signal: abortController.signal,
					onProgress: (progress) => {
						void Runtime.runPromise(
							runtime,
							context.offerOutbound(
								createAgentMessage("restore.progress", {
									...restoreContext,
									progress,
								}),
							),
						).catch((error) => {
							logger.error(`Failed to send restore progress update: ${toMessage(error)}`);
						});
					},
				});

				yield* context.offerOutbound(
					createAgentMessage("restore.completed", {
						...restoreContext,
						result,
					}),
				);
			}).pipe(
				Effect.catchAll((error) => {
					if (abortController.signal.aborted) {
						return context.offerOutbound(
							createAgentMessage("restore.cancelled", {
								...restoreContext,
								message: "Restore was cancelled",
							}),
						);
					}

					const errorMessage = toMessage(error);
					return context.offerOutbound(
						createAgentMessage("restore.failed", {
							...restoreContext,
							error: errorMessage,
							errorDetails: errorMessage,
						}),
					);
				}),
				Effect.ensuring(context.deleteRunningJob(payload.restoreId)),
			),
		);
	}).pipe(Effect.asVoid);
};
