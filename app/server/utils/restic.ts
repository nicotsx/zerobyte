/**
 * Restic utilities - organized into logical modules
 */

export * from "./restic/config";
export { buildEnv, buildRepoUrl } from "./restic/config";
export * from "./restic/operations";
export { backup, init, ls, restore, snapshots } from "./restic/operations";
export * from "./restic/repository";
export {
	check,
	copy,
	deleteSnapshot,
	deleteSnapshots,
	forget,
	repairIndex,
	tagSnapshots,
	unlock,
} from "./restic/repository";
// Re-export all schemas and types
export * from "./restic/schemas";
export * from "./restic/utils";
// Named exports for convenience
export {
	addCommonArgs,
	cleanupTempFile,
	cleanupTemporaryKeys,
	createTempFile,
	ensurePassfile,
	parseResticJsonOutput,
} from "./restic/utils";

import { backup, init, ls, restore, snapshots } from "./restic/operations";
import {
	check,
	copy,
	deleteSnapshot,
	deleteSnapshots,
	forget,
	repairIndex,
	tagSnapshots,
	unlock,
} from "./restic/repository";
// Legacy compatibility: export all functions under a single object
import { ensurePassfile } from "./restic/utils";

export const restic = {
	ensurePassfile,
	init,
	backup,
	restore,
	snapshots,
	forget,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
	unlock,
	ls,
	check,
	repairIndex,
	copy,
};
