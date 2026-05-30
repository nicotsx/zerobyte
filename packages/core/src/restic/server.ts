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
import { logResticLockFailureDiagnostics } from "./lock-diagnostics";
import type { RepositoryConfig } from "./schemas";
import type { ResticDeps } from "./types";

export { addCommonArgs } from "./helpers/add-common-args";
export { buildEnv } from "./helpers/build-env";
export { buildRepoUrl } from "./helpers/build-repo-url";
export { cleanupTemporaryKeys } from "./helpers/cleanup-temporary-keys";
export { validateCustomResticParams } from "./helpers/validate-custom-params";
export { isResticLockFailure, logResticLockFailureDiagnostics } from "./lock-diagnostics";
export { isResticError, ResticError, ResticLockError } from "./error";

type LockDiagnosticCommandContext = {
	repositoryConfig: RepositoryConfig;
	organizationId: string;
	relatedRepositoryConfigs?: RepositoryConfig[];
};

type ResticCommandOptions = { organizationId: string };
type ResticCommandResult = { error?: unknown };
type ResticCommandFailure<Failure> = Failure | ResticLockError;
type RunResticCommand<Success, Failure, Requirements> = () => Effect.Effect<
	Success,
	ResticCommandFailure<Failure>,
	Requirements
>;

const getCommandContext = (operation: string, args: unknown[]): LockDiagnosticCommandContext => {
	const firstRepositoryConfig = args[0] as RepositoryConfig;
	const options = args.at(-1) as ResticCommandOptions;

	if (operation === "restic.copy") {
		return {
			repositoryConfig: args[1] as RepositoryConfig,
			organizationId: options.organizationId,
			relatedRepositoryConfigs: [firstRepositoryConfig],
		};
	}

	return {
		repositoryConfig: firstRepositoryConfig,
		organizationId: options.organizationId,
	};
};

const logLockFailure = async (
	error: unknown,
	operation: string,
	context: LockDiagnosticCommandContext,
	deps: ResticDeps,
) =>
	logResticLockFailureDiagnostics({
		error,
		operation,
		repositoryConfig: context.repositoryConfig,
		organizationId: context.organizationId,
		resticDeps: deps,
		relatedRepositoryConfigs: context.relatedRepositoryConfigs,
	});

const unlockStaleLocks = (context: LockDiagnosticCommandContext, deps: ResticDeps): Effect.Effect<void, Error> =>
	Effect.gen(function* () {
		for (const repositoryConfig of [context.repositoryConfig, ...(context.relatedRepositoryConfigs ?? [])]) {
			yield* unlock(repositoryConfig, { organizationId: context.organizationId }, deps);
		}
	});

const recoverFromLockFailure = <Success, Failure, Requirements>(
	error: ResticLockError,
	operation: string,
	context: LockDiagnosticCommandContext,
	deps: ResticDeps,
	runCommand: RunResticCommand<Success, Failure, Requirements>,
): Effect.Effect<Success, ResticCommandFailure<Failure> | Error, Requirements> =>
	Effect.gen(function* () {
		yield* logger.effect.warn("Restic lock failure detected. Removing stale locks and retrying once.");
		yield* Effect.promise(() => logLockFailure(error, operation, context, deps));
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
		const context = getCommandContext(operation, args);
		const runCommand = () => command(...args, deps);

		const commandEffect = runCommand().pipe(
			Effect.catchTag("ResticLockError", (error) =>
				recoverFromLockFailure(error as ResticLockError, operation, context, deps, runCommand),
			),
		);

		return commandEffect.pipe(
			Effect.tap((result) => {
				const { error } = result as ResticCommandResult;
				return error ? Effect.promise(() => logLockFailure(error, operation, context, deps)) : Effect.void;
			}),
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
