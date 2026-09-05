import type { ControllerMessage } from "@zerobyte/contracts/agent-protocol";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { Effect } from "effect";
import { handleBackupCancelCommand } from "./backup-cancel";
import { handleBackupRunCommand } from "./backup-run";
import type { ControllerCommandContext } from "../context";
import { handleHeartbeatPingCommand } from "./heartbeat-ping";
import { handleRestoreCancelCommand } from "./restore-cancel";
import { handleRestoreRunCommand } from "./restore";
import { handleVolumeCommand } from "./volume";
import { getAgentExecutionPolicy } from "../execution-policy";

export const handleControllerCommand = (context: ControllerCommandContext, message: ControllerMessage) => {
	switch (message.type) {
		case "backup.run": {
			return handleBackupRunCommand(context, message.payload);
		}
		case "backup.cancel": {
			return handleBackupCancelCommand(context, message.payload);
		}
		case "volume.command": {
			return handleVolumeCommand(context, message.payload);
		}
		case "restore.run": {
			const executionPolicy = getAgentExecutionPolicy(context);
			const restoreContext = {
				restoreId: message.payload.restoreId,
				organizationId: message.payload.organizationId,
				repositoryId: message.payload.repositoryId,
				snapshotId: message.payload.snapshotId,
			};
			return Effect.try({
				try: () => executionPolicy.assertLocalOperation("restore.run"),
				catch: () => "Restore is not allowed by this agent's execution policy",
			}).pipe(
				Effect.flatMap(() => handleRestoreRunCommand(context, message.payload)),
				Effect.catchAll((error) =>
					context.offerOutbound(
						createAgentMessage("restore.failed", {
							...restoreContext,
							error,
						}),
					),
				),
				Effect.asVoid,
			);
		}
		case "restore.cancel": {
			return handleRestoreCancelCommand(context, message.payload);
		}
		case "heartbeat.ping": {
			return handleHeartbeatPingCommand(context, message.payload);
		}
	}
};
