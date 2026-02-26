import { backup } from "./commands/backup";
import { check } from "./commands/check";
import { copy } from "./commands/copy";
import { deleteSnapshot, deleteSnapshots } from "./commands/delete-snapshots";
import { dump } from "./commands/dump";
import { forget } from "./commands/forget";
import { init } from "./commands/init";
import { keyAdd } from "./commands/key-add";
import { ls } from "./commands/ls";
import { repairIndex } from "./commands/repair-index";
import { restore } from "./commands/restore";
import { snapshots } from "./commands/snapshots";
import { stats } from "./commands/stats";
import { tagSnapshots } from "./commands/tag-snapshots";
import { unlock } from "./commands/unlock";

export { addCommonArgs } from "./helpers/add-common-args";
export { buildEnv } from "./helpers/build-env";
export { buildRepoUrl } from "./helpers/build-repo-url";
export { cleanupTemporaryKeys } from "./helpers/cleanup-temporary-keys";

export type { RestoreProgress } from "./commands/restore";
export type { ForgetGroup, ForgetReason, ResticDumpStream, ResticForgetResponse, Snapshot } from "./types";

export const restic = {
	init,
	keyAdd,
	backup,
	restore,
	dump,
	snapshots,
	stats,
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
