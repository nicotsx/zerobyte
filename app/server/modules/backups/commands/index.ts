import { createMirrorSyncCommand } from "./mirror-sync-command";
import { createForgetCommand } from "./forget-command";

export const commands = {
	createForget: createForgetCommand,
	createMirrorSync: createMirrorSyncCommand,
};
