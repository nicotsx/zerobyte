import { createMirrorSyncCommand, hasActiveMirrorSync } from "./mirror-sync-command";

export const commands = {
	createMirrorSync: createMirrorSyncCommand,
	hasActiveMirrorSync,
};
