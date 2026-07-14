import { Effect } from "effect";
import { logger } from "../node";
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
import { ResticLockError } from "./error";
import type { RepositoryConfig } from "./schemas";
import type { ResticDeps } from "./types";

export { addCommonArgs } from "./helpers/add-common-args";
export { buildEnv } from "./helpers/build-env";
export { buildRepoUrl } from "./helpers/build-repo-url";
export { cleanupTemporaryKeys } from "./helpers/cleanup-temporary-keys";
export { validateCustomResticParams } from "./helpers/validate-custom-params";
export { isResticError, ResticError, ResticLockError } from "./error";

type LockRecoveryContext = {
	repositoryConfigs: RepositoryConfig[];
	organizationId: string;
	signal?: AbortSignal;
};

type ResticCommandOptions = { organizationId: string; signal?: AbortSignal };
type ResticCommandFailure<Failure> = Failure | ResticLockError;
type RunResticCommand<Success, Failure, Requirements> = () => Effect.Effect<
	Success,
	ResticCommandFailure<Failure>,
	Requirements
>;

const getLockRecoveryContext = (operation: string, args: unknown[]): LockRecoveryContext => {
	const firstRepositoryConfig = args[0] as RepositoryConfig;
	const options = args.at(-1) as ResticCommandOptions;

	if (operation === "restic.copy") {
		return {
			repositoryConfigs: [args[1] as RepositoryConfig, firstRepositoryConfig],
			organizationId: options.organizationId,
			signal: options.signal,
		};
	}

	return {
		repositoryConfigs: [firstRepositoryConfig],
		organizationId: options.organizationId,
		signal: options.signal,
	};
};

const unlockStaleLocks = (context: LockRecoveryContext, deps: ResticDeps) =>
	Effect.gen(function* () {
		for (const repositoryConfig of context.repositoryConfigs) {
			yield* unlock(repositoryConfig, { organizationId: context.organizationId, signal: context.signal }, deps);
		}
	}).pipe(Effect.catchAll(() => Effect.void));

const recoverFromLockFailure = <Success, Failure, Requirements>(
	context: LockRecoveryContext,
	runCommand: RunResticCommand<Success, Failure, Requirements>,
	deps: ResticDeps,
): Effect.Effect<Success, ResticCommandFailure<Failure> | Error, Requirements> =>
	Effect.gen(function* () {
		yield* logger.effect.warn("Restic lock failure detected. Removing stale locks and retrying once.");
		yield* unlockStaleLocks(context, deps);

		const retryResult = yield* runCommand();
		yield* logger.effect.info("Restic lock failure recovered by removing stale locks and retrying once.");

		return retryResult;
	});

function withDeps<Args extends unknown[], Success, Failure, Requirements>(
	operation: string,
	command: (...args: [...Args, ResticDeps]) => Effect.Effect<Success, ResticCommandFailure<Failure>, Requirements>,
	deps: ResticDeps,
): (...args: Args) => Effect.Effect<Success, ResticCommandFailure<Failure> | Error, Requirements> {
	return (...args: Args) => {
		const context = getLockRecoveryContext(operation, args);
		const runCommand = () => command(...args, deps);

		return runCommand().pipe(
			Effect.catchTag("ResticLockError", () => recoverFromLockFailure(context, runCommand, deps)),
		);
	};
}

export const createRestic = (deps: ResticDeps) => ({
	init: withDeps("restic.init", init, deps),
	keyAdd: withDeps("restic.keyAdd", keyAdd, deps),
	backup: withDeps("restic.backup", backup, deps),
	restore: withDeps("restic.restore", restore, deps),
	dump: withDeps("restic.dump", dump, deps),
	snapshots: withDeps("restic.snapshots", snapshots, deps),
	stats: withDeps("restic.stats", stats, deps),
	forget: withDeps("restic.forget", forget, deps),
	deleteSnapshot: withDeps("restic.deleteSnapshot", deleteSnapshot, deps),
	deleteSnapshots: withDeps("restic.deleteSnapshots", deleteSnapshots, deps),
	tagSnapshots: withDeps("restic.tagSnapshots", tagSnapshots, deps),
	unlock: withDeps("restic.unlock", unlock, deps),
	ls: withDeps("restic.ls", ls, deps),
	check: withDeps("restic.check", check, deps),
	repairIndex: withDeps("restic.repairIndex", repairIndex, deps),
	copy: withDeps("restic.copy", copy, deps),
});
