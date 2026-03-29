import type { ControllerMessage } from "@zerobyte/contracts/agent-protocol";
import { handleBackupCancelCommand } from "./backup-cancel";
import { handleBackupRunCommand } from "./backup-run";
import type { ControllerCommandContext } from "../context";
import { handleHeartbeatPingCommand } from "./heartbeat-ping";

export const handleControllerCommand = (context: ControllerCommandContext, message: ControllerMessage) => {
	switch (message.type) {
		case "backup.run": {
			return handleBackupRunCommand(context, message.payload);
		}
		case "backup.cancel": {
			return handleBackupCancelCommand(context, message.payload);
		}
		case "heartbeat.ping": {
			return handleHeartbeatPingCommand(context, message.payload);
		}
	}
};
