import type { Repository } from "~/server/db/schema";
import type { TaskResult } from "~/schemas/tasks";
import { repoMutex } from "../../../core/repository-mutex";
import { restic } from "../../../core/restic";
import { runEffectPromise } from "../../../utils/errors";
import { runTaskLifecycle } from "../../tasks/tasks.lifecycle";
import { taskStore } from "../../tasks/tasks.store";

type MirrorStatusPlan = {
	organizationId: string;
	scheduleId: number;
	scheduleShortId: string;
	targetDisplayName: string;
	sourceRepository: Repository;
	mirrorRepository: Repository;
};

type MirrorStatusTaskResult = Extract<TaskResult, { kind: "mirrorStatus" }>;

const getTaskResource = (plan: MirrorStatusPlan) => {
	const operationKey = `${plan.sourceRepository.id}:${plan.mirrorRepository.shortId}`;

	return {
		organizationId: plan.organizationId,
		kind: "mirrorStatus" as const,
		resourceType: "backup_schedule" as const,
		resourceId: plan.scheduleShortId,
		operationKey,
	};
};

const getLockRequests = (plan: MirrorStatusPlan, taskId: string) => {
	const sourceLock = {
		repositoryId: plan.sourceRepository.id,
		type: "shared" as const,
		operation: `mirror_status_source:${taskId}`,
	};
	const sourceIsMirror = plan.sourceRepository.id === plan.mirrorRepository.id;
	if (sourceIsMirror) {
		return [sourceLock];
	}

	const mirrorLock = {
		repositoryId: plan.mirrorRepository.id,
		type: "shared" as const,
		operation: `mirror_status_mirror:${taskId}`,
	};
	return [sourceLock, mirrorLock];
};

const getMirrorStatus = async (plan: MirrorStatusPlan, signal: AbortSignal): Promise<MirrorStatusTaskResult> => {
	const peerAbort = new AbortController();
	const lookupSignal = AbortSignal.any([signal, peerAbort.signal]);
	const sourceLookup = runEffectPromise(
		restic.snapshots(plan.sourceRepository.config, {
			tags: [plan.scheduleShortId],
			organizationId: plan.organizationId,
			signal: lookupSignal,
		}),
	);
	const mirrorLookup = runEffectPromise(
		restic.snapshots(plan.mirrorRepository.config, {
			tags: [plan.scheduleShortId],
			organizationId: plan.organizationId,
			signal: lookupSignal,
		}),
	);
	const [sourceSnapshots, mirrorSnapshots] = await Promise.all([sourceLookup, mirrorLookup]).catch(
		async (error: unknown) => {
			peerAbort.abort();
			await Promise.allSettled([sourceLookup, mirrorLookup]);
			throw error;
		},
	);

	const mirrorSnapshotTimes = new Set(mirrorSnapshots.map((snapshot) => snapshot.time));
	const missingSnapshots = sourceSnapshots
		.filter((snapshot) => !mirrorSnapshotTimes.has(snapshot.time))
		.map((snapshot) => ({
			short_id: snapshot.short_id,
			time: snapshot.time,
			size: snapshot.summary?.total_bytes_processed ?? 0,
		}));

	return {
		kind: "mirrorStatus",
		sourceCount: sourceSnapshots.length,
		mirrorCount: mirrorSnapshots.length,
		missingSnapshots,
	};
};

export const pruneExpiredMirrorStatus = () => {
	return taskStore.deleteFinishedBefore({
		kind: "mirrorStatus",
		finishedBefore: Date.now() - 24 * 60 * 60 * 1000,
	});
};

export const createMirrorStatusCommand = (plan: MirrorStatusPlan) => {
	return {
		start: () => {
			pruneExpiredMirrorStatus();
			const taskResource = getTaskResource(plan);
			const activeTask = taskStore.findActiveByResource(taskResource);
			if (activeTask) {
				return { taskId: activeTask.id, status: "started" as const };
			}

			const task = taskStore.create({
				organizationId: plan.organizationId,
				resourceType: taskResource.resourceType,
				resourceId: taskResource.resourceId,
				targetDisplayName: plan.targetDisplayName,
				operationKey: taskResource.operationKey,
				input: {
					kind: "mirrorStatus",
					scheduleId: plan.scheduleId,
					scheduleShortId: plan.scheduleShortId,
					sourceRepositoryId: plan.sourceRepository.id,
					mirrorRepositoryId: plan.mirrorRepository.shortId,
				},
			});

			void runTaskLifecycle({
				taskId: task.id,
				label: "mirror status task",
				cancellable: true,
				prepare: (signal) => {
					const lockRequests = getLockRequests(plan, task.id);
					return repoMutex.acquireMany(lockRequests, signal);
				},
				run: (signal) => getMirrorStatus(plan, signal),
			});

			return { taskId: task.id, status: "started" as const };
		},
	};
};
