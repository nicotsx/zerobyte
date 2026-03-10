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

export * from "./schemas";
export * from "./restic-dto";

export type { RestoreProgress } from "./commands/restore";
export type {
	ResticDeps,
	ResticEnv,
	RetentionPolicy,
	ForgetGroup,
	ForgetReason,
	ResticDumpStream,
	ResticForgetResponse,
	Snapshot,
} from "./types";

export const createRestic = (deps: ResticDeps) => ({
	init: (
		config: Parameters<typeof init>[0],
		organizationId: Parameters<typeof init>[1],
		options?: { timeoutMs?: number },
	) => init(config, organizationId, options, deps),
	keyAdd: (
		config: Parameters<typeof keyAdd>[0],
		organizationId: Parameters<typeof keyAdd>[1],
		options: Parameters<typeof keyAdd>[2],
	) => keyAdd(config, organizationId, options, deps),
	backup: (
		config: Parameters<typeof backup>[0],
		source: Parameters<typeof backup>[1],
		options: Parameters<typeof backup>[2],
	) => backup(config, source, options, deps),
	restore: (
		config: Parameters<typeof restore>[0],
		snapshotId: Parameters<typeof restore>[1],
		target: Parameters<typeof restore>[2],
		options: Parameters<typeof restore>[3],
	) => restore(config, snapshotId, target, options, deps),
	dump: (
		config: Parameters<typeof dump>[0],
		snapshotRef: Parameters<typeof dump>[1],
		options: Parameters<typeof dump>[2],
	) => dump(config, snapshotRef, options, deps),
	snapshots: (config: Parameters<typeof snapshots>[0], options: Parameters<typeof snapshots>[1]) =>
		snapshots(config, options, deps),
	stats: (config: Parameters<typeof stats>[0], options: Parameters<typeof stats>[1]) => stats(config, options, deps),
	forget: (
		config: Parameters<typeof forget>[0],
		options: Parameters<typeof forget>[1],
		extra: Parameters<typeof forget>[2],
	) => forget(config, options, extra, deps),
	deleteSnapshot: (
		config: Parameters<typeof deleteSnapshot>[0],
		snapshotId: Parameters<typeof deleteSnapshot>[1],
		organizationId: Parameters<typeof deleteSnapshot>[2],
	) => deleteSnapshot(config, snapshotId, organizationId, deps),
	deleteSnapshots: (
		config: Parameters<typeof deleteSnapshots>[0],
		snapshotIds: Parameters<typeof deleteSnapshots>[1],
		organizationId: Parameters<typeof deleteSnapshots>[2],
	) => deleteSnapshots(config, snapshotIds, organizationId, deps),
	tagSnapshots: (
		config: Parameters<typeof tagSnapshots>[0],
		snapshotIds: Parameters<typeof tagSnapshots>[1],
		tags: Parameters<typeof tagSnapshots>[2],
		organizationId: Parameters<typeof tagSnapshots>[3],
	) => tagSnapshots(config, snapshotIds, tags, organizationId, deps),
	unlock: (config: Parameters<typeof unlock>[0], options: Parameters<typeof unlock>[1]) =>
		unlock(config, options, deps),
	ls: (
		config: Parameters<typeof ls>[0],
		snapshotId: Parameters<typeof ls>[1],
		organizationId: Parameters<typeof ls>[2],
		path?: Parameters<typeof ls>[3],
		options?: Parameters<typeof ls>[4],
	) => ls(config, snapshotId, organizationId, path, options, deps),
	check: (config: Parameters<typeof check>[0], options: Parameters<typeof check>[1]) => check(config, options, deps),
	repairIndex: (config: Parameters<typeof repairIndex>[0], options: Parameters<typeof repairIndex>[1]) =>
		repairIndex(config, options, deps),
	copy: (
		sourceConfig: Parameters<typeof copy>[0],
		destConfig: Parameters<typeof copy>[1],
		options: Parameters<typeof copy>[2],
	) => copy(sourceConfig, destConfig, options, deps),
});
