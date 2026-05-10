import os from "node:os";
import path from "node:path";
import { Effect, Runtime } from "effect";
import { createAgentMessage, type RestoreCommandPayload } from "@zerobyte/contracts/agent-protocol";
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

export const handleRestoreCommand = (context: ControllerCommandContext, payload: RestoreCommandPayload) => {
	return Effect.gen(function* () {
		assertAllowedRestoreTarget(payload.target);

		const runtime = yield* Effect.runtime<never>();
		const restic = createRestic(resticDeps(payload.runtime.password));
		const result = yield* restic.restore(payload.repositoryConfig, payload.snapshotId, payload.target, {
			...payload.options,
			onProgress: (progress) => {
				void Runtime.runPromise(
					runtime,
					context.offerOutbound(
						createAgentMessage("restore.progress", {
							commandId: payload.commandId,
							organizationId: payload.organizationId,
							repositoryId: payload.repositoryId,
							snapshotId: payload.snapshotId,
							progress,
						}),
					),
				).catch((error) => {
					logger.error(`Failed to send restore progress update: ${toMessage(error)}`);
				});
			},
		});

		yield* context.offerOutbound(
			createAgentMessage("restore.commandResult", {
				commandId: payload.commandId,
				status: "success",
				result,
			}),
		);
	}).pipe(
		Effect.catchAll((error) =>
			context.offerOutbound(
				createAgentMessage("restore.commandResult", {
					commandId: payload.commandId,
					status: "error",
					error: toMessage(error),
				}),
			),
		),
	);
};
