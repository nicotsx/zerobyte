import { createMirrorSyncCommand } from "./mirror-sync-command";
import { createMirrorStatusCommand } from "./mirror-status-command";
import { createForgetCommand } from "./forget-command";

export const commands = {
	createForget: createForgetCommand,
	createMirrorSync: createMirrorSyncCommand,
	createMirrorStatus: createMirrorStatusCommand,
};
