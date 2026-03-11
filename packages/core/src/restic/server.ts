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
import type { ResticDeps } from "./types";

export { addCommonArgs } from "./helpers/add-common-args";
export { buildEnv } from "./helpers/build-env";
export { buildRepoUrl } from "./helpers/build-repo-url";
export { cleanupTemporaryKeys } from "./helpers/cleanup-temporary-keys";
export { validateCustomResticParams } from "./helpers/validate-custom-params";
export { ResticError } from "./error";

function withDeps<Args extends unknown[], Result>(
	command: (...args: [...Args, ResticDeps]) => Result,
	deps: ResticDeps,
): (...args: Args) => Result {
	return (...args: Args) => command(...args, deps);
}

export const createRestic = (deps: ResticDeps) => ({
	init: withDeps(init, deps),
	keyAdd: withDeps(keyAdd, deps),
	backup: withDeps(backup, deps),
	restore: withDeps(restore, deps),
	dump: withDeps(dump, deps),
	snapshots: withDeps(snapshots, deps),
	stats: withDeps(stats, deps),
	forget: withDeps(forget, deps),
	deleteSnapshot: withDeps(deleteSnapshot, deps),
	deleteSnapshots: withDeps(deleteSnapshots, deps),
	tagSnapshots: withDeps(tagSnapshots, deps),
	unlock: withDeps(unlock, deps),
	ls: withDeps(ls, deps),
	check: withDeps(check, deps),
	repairIndex: withDeps(repairIndex, deps),
	copy: withDeps(copy, deps),
});
