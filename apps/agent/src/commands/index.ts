import type { ControllerMessage } from "@zerobyte/contracts/agent-protocol";
import { createAgentMessage } from "@zerobyte/contracts/agent-protocol";
import { Effect } from "effect";
import { handleBackupCancelCommand } from "./backup-cancel";
import { handleBackupRunCommand } from "./backup-run";
import type { ControllerCommandContext } from "../context";
import { handleHeartbeatPingCommand } from "./heartbeat-ping";
import { handleRestoreCancelCommand } from "./restore-cancel";
import { handleRestoreRunCommand } from "./restore";
import { handleFilesystemCommand } from "./filesystem";

export const handleControllerCommand = (context: ControllerCommandContext, message: ControllerMessage) => {
	switch (message.type) {
		case "backup.run": {
			return handleBackupRunCommand(context, message.payload);
		}
		case "backup.cancel": {
			return handleBackupCancelCommand(context, message.payload);
		}
		case "filesystem.command": {
			return handleFilesystemCommand(context, message.payload);
		}
		case "restore.run": {
			if (!context.allowRestore) {
				return context
					.offerOutbound(
						createAgentMessage("restore.failed", {
							restoreId: message.payload.restoreId,
							organizationId: message.payload.organizationId,
							repositoryId: message.payload.repositoryId,
							snapshotId: message.payload.snapshotId,
							error: "Restore is not allowed on this agent",
						}),
					)
					.pipe(Effect.asVoid);
			}

			return handleRestoreRunCommand(context, message.payload);
		}
		case "restore.cancel": {
			return handleRestoreCancelCommand(context, message.payload);
		}
		case "heartbeat.ping": {
			return handleHeartbeatPingCommand(context, message.payload);
		}
	}
};
