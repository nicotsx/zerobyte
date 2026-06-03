import * as os from "node:os";
import nodePath from "node:path";
import { and, eq } from "drizzle-orm";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import {
	type CompressionMode,
	type OverwriteMode,
	type RepositoryConfig,
	type ResticDumpStream,
	type ResticStatsDto,
	repositoryConfigSchema,
} from "@zerobyte/core/restic";
import { isPathWithin } from "@zerobyte/core/utils";
import { config as appConfig } from "~/server/core/config";
import { DATABASE_URL, RESTORE_BLOCKED_ROOTS, RESTIC_PASS_FILE } from "~/server/core/constants";
import { serverEvents } from "~/server/core/events";
import { getOrganizationId } from "~/server/core/request-context";
import { logger } from "@zerobyte/core/node";
import { parseRetentionCategories, type RetentionCategory } from "~/server/utils/retention-categories";
import { repoMutex } from "../../core/repository-mutex";
import { db } from "../../db/db";
import { repositoriesTable, type Repository, type RepositoryInsert } from "../../db/schema";
import { cache, cacheKeys } from "../../utils/cache";
import { runEffectPromise, toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys } from "@zerobyte/core/restic/server";
import { restic, resticDeps } from "../../core/restic";
import { safeSpawn } from "@zerobyte/core/node";
import type { DumpPathKind, UpdateRepositoryBody } from "./repositories.dto";
import { findCommonAncestor } from "@zerobyte/core/utils";
import { prepareSnapshotDump } from "./helpers/dump";
import { executeDoctor } from "./helpers/doctor";
import { restoreExecutor } from "./restore-executor";
import type { ShortId } from "~/server/utils/branded";
import { decryptRepositoryConfig, encryptRepositoryConfig } from "./repository-config-secrets";
import { getScheduleByIdOrShortId } from "../backups/helpers/backup-schedule-lookups";
import type { RestoreExecutionProgress, RestoreExecutionResult } from "../agents/agents-manager";
import { agentsService } from "../agents/agents.service";
import { LOCAL_AGENT_ID } from "../agents/constants";
import { taskStore } from "../tasks/tasks.store";
import type { ParsedTask, TaskInput } from "../tasks/tasks.schemas";
import { Effect } from "effect";

const runningDoctors = new Map<string, AbortController>();
const RESTORE_TASK_RESOURCE_TYPE = "repository";

type RestoreTaskInput = Extract<TaskInput, { kind: "restore" }>;
type RestoreTask = ParsedTask & { kind: "restore"; input: RestoreTaskInput };

const emptyRepositoryStats: ResticStatsDto = {
	total_size: 0,
	total_uncompressed_size: 0,
	compression_ratio: 0,
	compression_progress: 0,
	compression_space_saving: 0,
	snapshots_count: 0,
};

const getBlockedRestoreTargets = () => {
	return [
		...RESTORE_BLOCKED_ROOTS,
		DATABASE_URL === ":memory:" ? undefined : nodePath.dirname(nodePath.resolve(DATABASE_URL)),
		nodePath.dirname(nodePath.resolve(RESTIC_PASS_FILE)),
		nodePath.resolve(os.tmpdir()),
		appConfig.provisioningPath ? nodePath.dirname(nodePath.resolve(appConfig.provisioningPath)) : undefined,
	].filter((e) => e !== undefined);
};

const assertAllowedControllerLocalRestoreTarget = (target: string) => {
	const resolvedTarget = nodePath.resolve(target);

	for (const blockedTarget of getBlockedRestoreTargets()) {
		if (isPathWithin(blockedTarget, resolvedTarget)) {
			throw new BadRequestError(
				"Restore target path is not allowed. Restoring to this path could overwrite critical system files or application data.",
			);
		}
	}
};

const isRestoreTask = (task: ParsedTask): task is RestoreTask =>
	task.kind === "restore" && task.input.kind === "restore";

const asRestoreTask = (task: ParsedTask, restoreId: string, eventName: string) => {
	if (!isRestoreTask(task)) {
		logger.warn(`Received ${eventName} for non-restore task ${restoreId}`);
		return null;
	}

	return task;
};

const updateActiveRestoreTask = (restoreId: string, eventName: string, update: () => ParsedTask) => {
	try {
		return asRestoreTask(update(), restoreId, eventName);
	} catch (error) {
		logger.warn(`Received ${eventName} for inactive restore ${restoreId}: ${toMessage(error)}`);
		return null;
	}
};

const findActiveRestoreTask = (
	organizationId: string,
	repositoryShortId: string,
	snapshotId: string,
): RestoreTask | null => {
	return (
		taskStore
			.listActiveByResource({
				organizationId,
				kind: "restore",
				resourceType: RESTORE_TASK_RESOURCE_TYPE,
				resourceId: repositoryShortId,
			})
			.find((task): task is RestoreTask => isRestoreTask(task) && task.input.snapshotId === snapshotId) ?? null
	);
};

const emitRestoreStarted = (task: RestoreTask) => {
	serverEvents.emit("restore:started", {
		restoreId: task.id,
		organizationId: task.organizationId,
		repositoryId: task.input.repositoryId,
		snapshotId: task.input.snapshotId,
	});
};

const emitRestoreProgress = (task: RestoreTask, progress: RestoreExecutionProgress) => {
	serverEvents.emit("restore:progress", {
		restoreId: task.id,
		organizationId: task.organizationId,
		repositoryId: task.input.repositoryId,
		snapshotId: task.input.snapshotId,
		...progress,
	});
};

const emitRestoreCompleted = (
	task: RestoreTask,
	payload: {
		status: "success" | "error" | "cancelled";
		error?: string;
		filesRestored?: number;
		filesSkipped?: number;
	},
) => {
	serverEvents.emit("restore:completed", {
		restoreId: task.id,
		organizationId: task.organizationId,
		repositoryId: task.input.repositoryId,
		snapshotId: task.input.snapshotId,
		...payload,
	});
};

const markRestoreStarted = (restoreId: string) => {
	const task = updateActiveRestoreTask(restoreId, "restore.started", () => taskStore.markRunning(restoreId));
	if (!task) return;

	emitRestoreStarted(task);
};

const updateRestoreProgress = (restoreId: string, progress: RestoreExecutionProgress) => {
	const task = updateActiveRestoreTask(restoreId, "restore.progress", () =>
		taskStore.updateProgress(restoreId, { kind: "restore", progress }),
	);
	if (!task) return;

	emitRestoreProgress(task, progress);
};

const completeRestoreTask = (
	restoreId: string,
	result: Extract<RestoreExecutionResult, { status: "completed" }>["result"],
) => {
	const task = updateActiveRestoreTask(restoreId, "restore.completed", () =>
		taskStore.complete(restoreId, { kind: "restore", result }),
	);
	if (!task) return;

	emitRestoreCompleted(task, {
		status: "success",
		filesRestored: result.files_restored,
		filesSkipped: result.files_skipped,
	});
};

const failRestoreTask = (restoreId: string, error: string) => {
	const task = updateActiveRestoreTask(restoreId, "restore.failed", () => taskStore.fail(restoreId, error));
	if (!task) return;

	emitRestoreCompleted(task, { status: "error", error });
};

const cancelRestoreTask = (restoreId: string, message?: string) => {
	const task = updateActiveRestoreTask(restoreId, "restore.cancelled", () =>
		taskStore.cancel(restoreId, message ?? null),
	);
	if (!task) return;

	emitRestoreCompleted(task, { status: "cancelled", error: task.cancellationRequested ? undefined : message });
};

const finishRestoreExecution = async (restoreId: string, resultPromise: Promise<RestoreExecutionResult>) => {
	try {
		const result = await resultPromise;

		switch (result.status) {
			case "completed":
				completeRestoreTask(restoreId, result.result);
				return;
			case "failed":
				failRestoreTask(restoreId, result.error);
				return;
			case "cancelled":
				cancelRestoreTask(restoreId, result.message);
				return;
			case "unavailable":
				failRestoreTask(restoreId, result.error.message);
				return;
		}
	} catch (error) {
		failRestoreTask(restoreId, toMessage(error));
	}
};

const assertAllowedRestoreAgent = async (agentId: string, organizationId: string) => {
	if (agentId === LOCAL_AGENT_ID) {
		return;
	}

	const agent = await agentsService.getAgent(agentId);
	if (!agent || agent.organizationId !== organizationId) {
		throw new NotFoundError("Restore target agent not found");
	}
};

const findRepository = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	return await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ shortId: { eq: shortId } }, { organizationId }],
		},
	});
};

const listRepositories = async () => {
	const organizationId = getOrganizationId();
	const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
	return repositories;
};

const createRepository = async (name: string, config: RepositoryConfig, compressionMode?: CompressionMode) => {
	const organizationId = getOrganizationId();
	const id = Bun.randomUUIDv7();
	const shortId = generateShortId();
	if (config.backend === "local" && !config.isExistingRepository) {
		config.path = `${config.path}/${shortId}`;
	}

	const encryptedConfig = await encryptRepositoryConfig(config);

	const [created] = await db
		.insert(repositoriesTable)
		.values({
			id,
			shortId,
			name: name.trim(),
			type: config.backend,
			config: encryptedConfig,
			compressionMode: compressionMode ?? "auto",
			status: "unknown",
			organizationId,
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create repository");
	}

	let error: string | null = null;

	if (config.isExistingRepository) {
		const result = await runEffectPromise(restic.snapshots(encryptedConfig, { organizationId }))
			.then(() => ({ error: null }))
			.catch((error) => ({ error }));

		error = result.error;
	} else {
		const initResult = await runEffectPromise(
			restic.init(encryptedConfig, {
				organizationId,
				timeoutMs: appConfig.serverIdleTimeout * 1000,
			}),
		);
		error = initResult.error;
	}

	if (!error) {
		await db
			.update(repositoriesTable)
			.set({ status: "healthy", lastChecked: Date.now(), lastError: null })
			.where(and(eq(repositoriesTable.id, id), eq(repositoriesTable.organizationId, organizationId)));

		return { repository: created, status: 201 };
	}

	const errorMessage = toMessage(error);
	await db
		.delete(repositoriesTable)
		.where(and(eq(repositoriesTable.id, id), eq(repositoriesTable.organizationId, organizationId)));

	throw new InternalServerError(`Failed to initialize repository: ${errorMessage}`);
};

const getRepository = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return { repository };
};

const runAndStoreRepositoryStats = async (repository: Repository): Promise<ResticStatsDto> => {
	const releaseLock = await repoMutex.acquireShared(repository.id, "stats");
	try {
		const stats = await runEffectPromise(
			restic.stats(repository.config, { organizationId: repository.organizationId }),
		);

		await db
			.update(repositoriesTable)
			.set({ stats, statsUpdatedAt: Date.now() })
			.where(
				and(
					eq(repositoriesTable.id, repository.id),
					eq(repositoriesTable.organizationId, repository.organizationId),
				),
			);

		return stats;
	} finally {
		releaseLock();
	}
};

const refreshRepositoryStats = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return runAndStoreRepositoryStats(repository);
};

const getRepositoryStats = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return repository.stats ?? { ...emptyRepositoryStats };
};

const deleteRepository = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	// TODO: Add cleanup logic for the actual restic repository files

	await db
		.delete(repositoriesTable)
		.where(
			and(
				eq(repositoriesTable.id, repository.id),
				eq(repositoriesTable.organizationId, repository.organizationId),
			),
		);

	cache.delByPrefix(cacheKeys.repository.all(repository.id));
};

/**
 * List snapshots for a given repository
 * If backupId is provided, filter snapshots by that backup ID (tag)
 * @param shortId Repository short ID
 * @param backupId Optional backup ID to filter snapshots for a specific backup schedule
 *
 * @returns List of snapshots
 */
const listSnapshots = async (shortId: ShortId, backupId?: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id, backupId);
	const cached = cache.get<Effect.Effect.Success<ReturnType<typeof restic.snapshots>>>(cacheKey);
	if (cached) {
		return cached;
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, "snapshots");
	try {
		let snapshots = [];

		if (backupId) {
			snapshots = await runEffectPromise(
				restic.snapshots(repository.config, { tags: [backupId], organizationId }),
			);
		} else {
			snapshots = await runEffectPromise(restic.snapshots(repository.config, { organizationId }));
		}

		cache.set(cacheKey, snapshots);

		return snapshots;
	} finally {
		releaseLock();
	}
};

const listSnapshotFiles = async (
	shortId: ShortId,
	snapshotId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? 500;

	const cacheKey = cacheKeys.repository.ls(repository.id, snapshotId, path, offset, limit);
	type LsResult = {
		snapshot: {
			id: string;
			short_id: string;
			time: string;
			hostname: string;
			paths: string[];
		} | null;
		nodes: { name: string; type: string; path: string; size?: number; mode?: number }[];
		pagination: { offset: number; limit: number; total: number; hasMore: boolean };
	};
	const cached = cache.get<LsResult>(cacheKey);
	if (cached?.snapshot) {
		return {
			snapshot: cached.snapshot,
			files: cached.nodes,
			offset: cached.pagination.offset,
			limit: cached.pagination.limit,
			total: cached.pagination.total,
			hasMore: cached.pagination.hasMore,
		};
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `ls:${snapshotId}`);
	try {
		const result = await runEffectPromise(
			restic.ls(repository.config, snapshotId, path, { organizationId, offset, limit }),
		);

		if (!result.snapshot) {
			throw new NotFoundError("Snapshot not found or empty");
		}

		const response = {
			snapshot: {
				id: result.snapshot.id,
				short_id: result.snapshot.short_id,
				time: result.snapshot.time,
				hostname: result.snapshot.hostname,
				paths: result.snapshot.paths,
			},
			files: result.nodes,
			offset: result.pagination.offset,
			limit: result.pagination.limit,
			total: result.pagination.total,
			hasMore: result.pagination.hasMore,
		};

		cache.set(cacheKey, result);

		return response;
	} finally {
		releaseLock();
	}
};

const restoreSnapshot = async (
	shortId: ShortId,
	snapshotId: string,
	options?: {
		include?: string[];
		selectedItemKind?: "file" | "dir";
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		targetPath?: string;
		targetAgentId?: string;
		overwrite?: OverwriteMode;
	},
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const { targetAgentId, targetPath, ...restoreExecutionOptions } = options ?? {};
	const target = targetPath || "/";

	const snapshot = await getSnapshotDetails(repository.shortId, snapshotId);
	const hasNonPosixSnapshotPaths = snapshot.paths.some((path) => !path.startsWith("/"));

	if (hasNonPosixSnapshotPaths && !targetPath) {
		throw new BadRequestError(
			"Original location restore is unavailable for this snapshot. Restore it to a custom location instead.",
		);
	}

	const basePath = hasNonPosixSnapshotPaths ? "/" : findCommonAncestor(snapshot.paths);
	const executionAgentId = targetAgentId ?? LOCAL_AGENT_ID;
	const useControllerLocalRestoreFallback = executionAgentId === LOCAL_AGENT_ID && !appConfig.flags.enableLocalAgent;
	await assertAllowedRestoreAgent(executionAgentId, organizationId);

	if (!useControllerLocalRestoreFallback && repository.type === "local" && executionAgentId !== LOCAL_AGENT_ID) {
		throw new BadRequestError(
			"Local repository restores must run on the agent that can access the repository path.",
		);
	}

	if (executionAgentId === LOCAL_AGENT_ID) {
		assertAllowedControllerLocalRestoreTarget(target);
	}

	const activeRestore = findActiveRestoreTask(organizationId, repository.shortId, snapshotId);
	if (activeRestore) {
		throw new ConflictError("A restore is already running for this snapshot");
	}

	const task = taskStore.create({
		organizationId,
		resourceType: RESTORE_TASK_RESOURCE_TYPE,
		resourceId: repository.shortId,
		targetAgentId: useControllerLocalRestoreFallback ? null : executionAgentId,
		input: { kind: "restore", repositoryId: repository.shortId, snapshotId, target },
	});
	const restoreId = task.id;
	try {
		const repositoryConfig = await decryptRepositoryConfig(repository.config);
		const execution = restoreExecutor.start({
			restoreId,
			organizationId,
			repositoryId: repository.id,
			repositoryShortId: repository.shortId,
			repositoryConfig,
			snapshotId,
			target,
			executionAgentId,
			options: {
				basePath,
				...restoreExecutionOptions,
			},
			onStarted: () => markRestoreStarted(restoreId),
			onProgress: (progress) => updateRestoreProgress(restoreId, progress),
		});

		void finishRestoreExecution(restoreId, execution.result);

		return { restoreId, status: "started" as const };
	} catch (error) {
		failRestoreTask(restoreId, toMessage(error));
		throw error;
	}
};

const dumpSnapshot = async (shortId: ShortId, snapshotId: string, path?: string, kind?: DumpPathKind) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `dump:${snapshotId}`);
	let dumpStream: ResticDumpStream | null = null;

	try {
		const snapshot = await getSnapshotDetails(repository.shortId, snapshotId);
		const preparedDump = prepareSnapshotDump({
			snapshotId,
			snapshotPaths: snapshot.paths,
			requestedPath: path,
		});
		const dumpOptions: Parameters<typeof restic.dump>[2] = {
			organizationId,
			path: preparedDump.path,
		};

		let filename = preparedDump.filename;
		let contentType = "application/x-tar";

		if (path && preparedDump.path !== "/") {
			if (!kind) {
				throw new BadRequestError("Path kind is required when downloading a specific snapshot path");
			}

			if (kind === "file") {
				dumpOptions.archive = false;
				contentType = "application/octet-stream";
				const fileName = nodePath.posix.basename(preparedDump.path);
				if (fileName) {
					filename = fileName;
				}
			}
		}

		dumpStream = await runEffectPromise(restic.dump(repository.config, preparedDump.snapshotRef, dumpOptions));

		serverEvents.emit("dump:started", {
			organizationId,
			repositoryId: repository.shortId,
			snapshotId,
			path: preparedDump.path,
			filename,
		});

		const completion = dumpStream.completion.finally(releaseLock);
		void completion.catch(() => {});

		return { ...dumpStream, completion, filename, contentType };
	} catch (error) {
		if (dumpStream) {
			dumpStream.abort();
		}
		releaseLock();
		throw error;
	}
};

const getSnapshotDetails = async (shortId: ShortId, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id);
	let snapshots = cache.get<Effect.Effect.Success<ReturnType<typeof restic.snapshots>>>(cacheKey);

	if (!snapshots) {
		const releaseLock = await repoMutex.acquireShared(repository.id, `snapshot_details:${snapshotId}`);
		try {
			snapshots = await runEffectPromise(restic.snapshots(repository.config, { organizationId }));
			cache.set(cacheKey, snapshots);
		} finally {
			releaseLock();
		}
	}

	const snapshot = snapshots.find((snap) => snap.id === snapshotId || snap.short_id === snapshotId);

	if (!snapshot) {
		void refreshSnapshots(shortId).catch(() => {});

		throw new NotFoundError("Snapshot not found");
	}

	return snapshot;
};

const checkHealth = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "check");
	try {
		const { hasErrors, error } = await runEffectPromise(restic.check(repository.config, { organizationId }));

		await db
			.update(repositoriesTable)
			.set({
				status: hasErrors ? "error" : "healthy",
				lastChecked: Date.now(),
				lastError: error,
			})
			.where(
				and(
					eq(repositoriesTable.id, repository.id),
					eq(repositoriesTable.organizationId, repository.organizationId),
				),
			);

		return { lastError: error };
	} finally {
		releaseLock();
	}
};

const startDoctor = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	if (runningDoctors.has(repository.id)) {
		throw new ConflictError("Doctor operation already in progress");
	}

	const abortController = new AbortController();

	try {
		await db.update(repositoriesTable).set({ status: "doctor" }).where(eq(repositoriesTable.id, repository.id));

		serverEvents.emit("doctor:started", {
			organizationId: repository.organizationId,
			repositoryId: repository.shortId,
			repositoryName: repository.name,
		});

		runningDoctors.set(repository.id, abortController);
	} catch (error) {
		runningDoctors.delete(repository.id);
		throw error;
	}

	executeDoctor(repository.id, repository.shortId, repository.config, repository.name, abortController.signal)
		.catch((error) => {
			logger.error(`Doctor background task failed: ${toMessage(error)}`);
		})
		.finally(() => {
			runningDoctors.delete(repository.id);
		});

	return { message: "Doctor operation started", repositoryId: repository.shortId };
};

const cancelDoctor = async (shortId: ShortId) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const abortController = runningDoctors.get(repository.id);
	if (!abortController) {
		await db.update(repositoriesTable).set({ status: "unknown" }).where(eq(repositoriesTable.id, repository.id));
		throw new ConflictError("No doctor operation is currently running");
	}

	abortController.abort();
	runningDoctors.delete(repository.id);

	await db.update(repositoriesTable).set({ status: "unknown" }).where(eq(repositoriesTable.id, repository.id));

	serverEvents.emit("doctor:cancelled", {
		organizationId: repository.organizationId,
		repositoryId: repository.shortId,
		repositoryName: repository.name,
	});

	return { message: "Doctor operation cancelled" };
};

const deleteSnapshot = async (shortId: ShortId, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:${snapshotId}`);
	try {
		await runEffectPromise(restic.deleteSnapshot(repository.config, snapshotId, { organizationId }));
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
		void runAndStoreRepositoryStats(repository).catch((error) => {
			logger.error(
				`Failed to refresh repository stats after snapshot deletion for ${repository.shortId}: ${toMessage(error)}`,
			);
		});
	} finally {
		releaseLock();
	}
};

const deleteSnapshots = async (shortId: ShortId, snapshotIds: string[]) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	let shouldRefreshStats = false;
	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:bulk`);
	try {
		await runEffectPromise(restic.deleteSnapshots(repository.config, snapshotIds, { organizationId }));
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
		shouldRefreshStats = true;
	} finally {
		releaseLock();
	}

	if (!shouldRefreshStats) {
		return;
	}

	void runAndStoreRepositoryStats(repository).catch((error) => {
		logger.error(
			`Failed to refresh repository stats after snapshot deletion for ${repository.shortId}: ${toMessage(error)}`,
		);
	});
};

const tagSnapshots = async (
	shortId: ShortId,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `tag:bulk`);
	try {
		await runEffectPromise(restic.tagSnapshots(repository.config, snapshotIds, tags, { organizationId }));
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
	} finally {
		releaseLock();
	}
};

const refreshSnapshots = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	cache.delByPrefix(cacheKeys.repository.all(repository.id));

	const releaseLock = await repoMutex.acquireShared(repository.id, "refresh");
	try {
		const snapshots = await runEffectPromise(restic.snapshots(repository.config, { organizationId }));
		const cacheKey = cacheKeys.repository.snapshots(repository.id);
		cache.set(cacheKey, snapshots);

		return {
			message: "Snapshot cache cleared and refreshed",
			count: snapshots.length,
		};
	} finally {
		releaseLock();
	}
};

const updateRepository = async (shortId: ShortId, updates: UpdateRepositoryBody) => {
	const existing = await findRepository(shortId);

	if (!existing) {
		throw new NotFoundError("Repository not found");
	}

	const existingConfigResult = repositoryConfigSchema.safeParse(existing.config);
	if (!existingConfigResult.success) {
		throw new InternalServerError("Invalid repository configuration");
	}
	const existingConfig = existingConfigResult.data;

	let newName = existing.name;
	if (updates.name) {
		newName = updates.name.trim();
		if (newName.length === 0) {
			throw new BadRequestError("Repository name cannot be empty");
		}
	}

	let parsedConfig = existingConfig;
	if (updates.config) {
		const nextConfigResult = repositoryConfigSchema.safeParse(updates.config);
		if (!nextConfigResult.success) {
			throw new BadRequestError("Invalid repository configuration");
		}
		const nextConfig = nextConfigResult.data;

		if (nextConfig.backend !== existing.type) {
			throw new BadRequestError("Repository backend cannot be changed");
		}

		parsedConfig = nextConfig;
	}

	const decryptedExisting = await decryptRepositoryConfig(existingConfig);
	const configChanged = updates.config && JSON.stringify(decryptedExisting) !== JSON.stringify(parsedConfig);
	const encryptedConfig = updates.config ? await encryptRepositoryConfig(parsedConfig) : existingConfig;
	const updatedAt = Date.now();
	const updatePayload: Partial<RepositoryInsert> = {
		name: newName,
		compressionMode: updates.compressionMode ?? existing.compressionMode,
		updatedAt,
		config: encryptedConfig,
	};

	if (configChanged) {
		updatePayload.status = "unknown";
		updatePayload.lastChecked = null;
		updatePayload.lastError = null;
		updatePayload.doctorResult = null;
		updatePayload.stats = null;
		updatePayload.statsUpdatedAt = null;
	}

	const [updated] = await db
		.update(repositoriesTable)
		.set(updatePayload)
		.where(
			and(eq(repositoriesTable.id, existing.id), eq(repositoriesTable.organizationId, existing.organizationId)),
		)
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update repository");
	}

	if (configChanged) {
		cache.delByPrefix(cacheKeys.repository.all(existing.id));
	}

	return { repository: updated };
};

const unlockRepository = async (shortId: ShortId) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "unlock");
	try {
		const result = await runEffectPromise(restic.unlock(repository.config, { organizationId }));
		return result;
	} finally {
		releaseLock();
	}
};

const execResticCommand = async (
	shortId: ShortId,
	command: string,
	args: string[] | undefined,
	onStdout: (line: string) => void,
	onStderr: (line: string) => void,
	signal?: AbortSignal,
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const repoUrl = buildRepoUrl(repository.config);
	const env = await buildEnv(repository.config, organizationId, resticDeps);

	const resticArgs: string[] = ["--repo", repoUrl, command];
	if (args && args.length > 0) {
		resticArgs.push(...args);
	}
	addCommonArgs(resticArgs, env, repository.config);

	try {
		const result = await safeSpawn({
			command: "restic",
			args: resticArgs,
			env,
			signal,
			onStdout,
			onStderr,
		});
		return { exitCode: result.exitCode };
	} finally {
		await cleanupTemporaryKeys(env, resticDeps);
	}
};

const getRetentionCategories = async (repositoryId: ShortId, scheduleId?: ShortId) => {
	if (!scheduleId) {
		return new Map<string, RetentionCategory[]>();
	}

	try {
		const repository = await findRepository(repositoryId);
		if (!repository) {
			return new Map<string, RetentionCategory[]>();
		}

		const cacheKey = cacheKeys.repository.retention(repository.id, scheduleId);
		const cached = cache.get<Record<string, RetentionCategory[]>>(cacheKey);

		if (cached) {
			return new Map(Object.entries(cached));
		}

		const schedule = await getScheduleByIdOrShortId(scheduleId);

		if (!schedule?.retentionPolicy) {
			return new Map<string, RetentionCategory[]>();
		}

		const dryRunResults = await runEffectPromise(
			restic.forget(repository.config, schedule.retentionPolicy, {
				tag: scheduleId,
				organizationId: getOrganizationId(),
				dryRun: true,
			}),
		);

		if (!dryRunResults.data) {
			return new Map<string, RetentionCategory[]>();
		}

		const categories = parseRetentionCategories(dryRunResults.data);
		cache.set(cacheKey, Object.fromEntries(categories));

		return categories;
	} catch (error) {
		logger.error(`Failed to get retention categories: ${toMessage(error)}`);
		return new Map<string, RetentionCategory[]>();
	}
};

export const repositoriesService = {
	listRepositories,
	createRepository,
	getRepository,
	getRepositoryStats,
	refreshRepositoryStats,
	deleteRepository,
	updateRepository,
	listSnapshots,
	listSnapshotFiles,
	restoreSnapshot,
	dumpSnapshot,
	getSnapshotDetails,
	checkHealth,
	startDoctor,
	cancelDoctor,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
	refreshSnapshots,
	execResticCommand,
	getRetentionCategories,
	unlockRepository,
};
