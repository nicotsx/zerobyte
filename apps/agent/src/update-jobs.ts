import { Data, Effect, Exit, Scope } from "effect";

export class UpdateCommitting extends Data.TaggedError("UpdateCommitting") {
	override readonly message = "Agent is restarting for an update";
}

export class BackupScheduleBusy extends Data.TaggedError("BackupScheduleBusy") {
	override readonly message = "The previous run of this backup is still finishing. Try again shortly.";
}

export function createUpdateJobs() {
	const scope = Scope.makeUnsafe("parallel");
	const activeSchedules = new Set<string>();
	let committing = false;

	return {
		fork: <A, E>(run: Effect.Effect<A, E>) => Effect.forkIn(run, scope),
		close: Scope.close(scope, Exit.void),
		admit(scheduleId: string) {
			if (committing) return new UpdateCommitting();
			if (activeSchedules.has(scheduleId)) return new BackupScheduleBusy();

			activeSchedules.add(scheduleId);
		},
		finish(scheduleId: string) {
			activeSchedules.delete(scheduleId);
		},
		isIdle: () => activeSchedules.size === 0,
		beginCommit() {
			if (committing || activeSchedules.size > 0) return false;
			committing = true;
			return true;
		},
		cancelCommit() {
			committing = false;
		},
	};
}

export type UpdateJobs = ReturnType<typeof createUpdateJobs>;
