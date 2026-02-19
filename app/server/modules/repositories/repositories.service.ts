import crypto from "node:crypto";
import nodePath from "node:path";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import {
	type CompressionMode,
	type OverwriteMode,
	type RepositoryConfig,
	repositoryConfigSchema,
} from "~/schemas/restic";
import { serverEvents } from "~/server/core/events";
import { getOrganizationId } from "~/server/core/request-context";
import { logger } from "~/server/utils/logger";
import { parseRetentionCategories, type RetentionCategory } from "~/server/utils/retention-categories";
import { repoMutex } from "../../core/repository-mutex";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { cache, cacheKeys } from "../../utils/cache";
import { cryptoUtils } from "../../utils/crypto";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { addCommonArgs, buildEnv, buildRepoUrl, cleanupTemporaryKeys, restic } from "../../utils/restic";
import { safeSpawn } from "../../utils/spawn";
import { backupsService } from "../backups/backups.service";
import type { DumpPathKind, UpdateRepositoryBody } from "./repositories.dto";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { findCommonAncestor } from "~/utils/common-ancestor";
import { prepareSnapshotDump } from "./helpers/dump";
import { executeDoctor } from "./helpers/doctor";

const runningDoctors = new Map<string, AbortController>();

const findRepository = async (shortId: string) => {
	const organizationId = getOrganizationId();
	return await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ shortId }, { organizationId }],
		},
	});
};

const listRepositories = async () => {
	const organizationId = getOrganizationId();
	const repositories = await db.query.repositoriesTable.findMany({ where: { organizationId } });
	return repositories;
};

const encryptConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	const encryptedConfig: Record<string, unknown> = { ...config };

	if (config.customPassword) {
		encryptedConfig.customPassword = await cryptoUtils.sealSecret(config.customPassword);
	}

	if (config.cacert) {
		encryptedConfig.cacert = await cryptoUtils.sealSecret(config.cacert);
	}

	switch (config.backend) {
		case "s3":
		case "r2":
			encryptedConfig.accessKeyId = await cryptoUtils.sealSecret(config.accessKeyId);
			encryptedConfig.secretAccessKey = await cryptoUtils.sealSecret(config.secretAccessKey);
			break;
		case "gcs":
			encryptedConfig.credentialsJson = await cryptoUtils.sealSecret(config.credentialsJson);
			break;
		case "azure":
			encryptedConfig.accountKey = await cryptoUtils.sealSecret(config.accountKey);
			break;
		case "rest":
			if (config.username) {
				encryptedConfig.username = await cryptoUtils.sealSecret(config.username);
			}
			if (config.password) {
				encryptedConfig.password = await cryptoUtils.sealSecret(config.password);
			}
			break;
		case "sftp":
			encryptedConfig.privateKey = await cryptoUtils.sealSecret(config.privateKey);
			break;
	}

	return encryptedConfig as RepositoryConfig;
};

const decryptConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	const decryptedConfig: Record<string, unknown> = { ...config };

	if (config.customPassword) {
		decryptedConfig.customPassword = await cryptoUtils.resolveSecret(config.customPassword);
	}

	if (config.cacert) {
		decryptedConfig.cacert = await cryptoUtils.resolveSecret(config.cacert);
	}

	switch (config.backend) {
		case "s3":
		case "r2":
			decryptedConfig.accessKeyId = await cryptoUtils.resolveSecret(config.accessKeyId);
			decryptedConfig.secretAccessKey = await cryptoUtils.resolveSecret(config.secretAccessKey);
			break;
		case "gcs":
			decryptedConfig.credentialsJson = await cryptoUtils.resolveSecret(config.credentialsJson);
			break;
		case "azure":
			decryptedConfig.accountKey = await cryptoUtils.resolveSecret(config.accountKey);
			break;
		case "rest":
			if (config.username) {
				decryptedConfig.username = await cryptoUtils.resolveSecret(config.username);
			}
			if (config.password) {
				decryptedConfig.password = await cryptoUtils.resolveSecret(config.password);
			}
			break;
		case "sftp":
			decryptedConfig.privateKey = await cryptoUtils.resolveSecret(config.privateKey);
			break;
	}

	return decryptedConfig as RepositoryConfig;
};

const createRepository = async (name: string, config: RepositoryConfig, compressionMode?: CompressionMode) => {
	const organizationId = getOrganizationId();
	const id = crypto.randomUUID();
	const shortId = generateShortId();

	if (config.backend === "local" && config.path === REPOSITORY_BASE) {
		config.path = `${REPOSITORY_BASE}/${shortId}`;
	}

	const encryptedConfig = await encryptConfig(config);

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
		const result = await restic
			.snapshots(encryptedConfig, { organizationId })
			.then(() => ({ error: null }))
			.catch((error) => ({ error }));

		error = result.error;
	} else {
		const initResult = await restic.init(encryptedConfig, organizationId, { timeoutMs: 20000 });
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

const getRepository = async (shortId: string) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return { repository };
};

const getRepositoryStats = async (shortId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.stats(repository.id);
	const cached = cache.get<Awaited<ReturnType<typeof restic.stats>>>(cacheKey);
	if (cached) {
		return cached;
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, "stats");
	try {
		const stats = await restic.stats(repository.config, { organizationId });
		cache.set(cacheKey, stats);
		return stats;
	} finally {
		releaseLock();
	}
};

const deleteRepository = async (shortId: string) => {
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	// TODO: Add cleanup logic for the actual restic repository files

	await db
		.delete(repositoriesTable)
		.where(
			and(eq(repositoriesTable.id, repository.id), eq(repositoriesTable.organizationId, repository.organizationId)),
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
const listSnapshots = async (shortId: string, backupId?: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id, backupId);
	const cached = cache.get<Awaited<ReturnType<typeof restic.snapshots>>>(cacheKey);
	if (cached) {
		return cached;
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, "snapshots");
	try {
		let snapshots = [];

		if (backupId) {
			snapshots = await restic.snapshots(repository.config, { tags: [backupId], organizationId });
		} else {
			snapshots = await restic.snapshots(repository.config, { organizationId });
		}

		cache.set(cacheKey, snapshots);

		return snapshots;
	} finally {
		releaseLock();
	}
};

const listSnapshotFiles = async (
	shortId: string,
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
		snapshot: { id: string; short_id: string; time: string; hostname: string; paths: string[] } | null;
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
		const result = await restic.ls(repository.config, snapshotId, organizationId, path, { offset, limit });

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
	shortId: string,
	snapshotId: string,
	options?: {
		include?: string[];
		exclude?: string[];
		excludeXattr?: string[];
		delete?: boolean;
		targetPath?: string;
		overwrite?: OverwriteMode;
	},
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const target = options?.targetPath || "/";

	const { paths } = await getSnapshotDetails(repository.shortId, snapshotId);
	const basePath = findCommonAncestor(paths);

	const releaseLock = await repoMutex.acquireShared(repository.id, `restore:${snapshotId}`);
	try {
		serverEvents.emit("restore:started", {
			organizationId,
			repositoryId: repository.shortId,
			snapshotId,
		});

		const result = await restic.restore(repository.config, snapshotId, target, {
			basePath,
			...options,
			organizationId,
			onProgress: (progress) => {
				serverEvents.emit("restore:progress", {
					organizationId,
					repositoryId: repository.shortId,
					snapshotId,
					...progress,
				});
			},
		});

		serverEvents.emit("restore:completed", {
			organizationId,
			repositoryId: repository.shortId,
			snapshotId,
			status: "success",
		});

		return {
			success: true,
			message: "Snapshot restored successfully",
			filesRestored: result.files_restored,
			filesSkipped: result.files_skipped,
		};
	} catch (error) {
		serverEvents.emit("restore:completed", {
			organizationId,
			repositoryId: repository.shortId,
			snapshotId,
			status: "error",
			error: toMessage(error),
		});
		throw error;
	} finally {
		releaseLock();
	}
};

const dumpSnapshot = async (shortId: string, snapshotId: string, path?: string, kind?: DumpPathKind) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `dump:${snapshotId}`);
	let dumpStream: Awaited<ReturnType<typeof restic.dump>> | undefined = undefined;

	try {
		const snapshot = await getSnapshotDetails(repository.shortId, snapshotId);
		const preparedDump = prepareSnapshotDump({ snapshotId, snapshotPaths: snapshot.paths, requestedPath: path });
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

		dumpStream = await restic.dump(repository.config, preparedDump.snapshotRef, dumpOptions);

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

const getSnapshotDetails = async (shortId: string, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = cacheKeys.repository.snapshots(repository.id);
	let snapshots = cache.get<Awaited<ReturnType<typeof restic.snapshots>>>(cacheKey);

	if (!snapshots) {
		const releaseLock = await repoMutex.acquireShared(repository.id, `snapshot_details:${snapshotId}`);
		try {
			snapshots = await restic.snapshots(repository.config, { organizationId });
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

const checkHealth = async (repositoryId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(repositoryId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "check");
	try {
		const { hasErrors, error } = await restic.check(repository.config, { organizationId });

		await db
			.update(repositoriesTable)
			.set({
				status: hasErrors ? "error" : "healthy",
				lastChecked: Date.now(),
				lastError: error,
			})
			.where(
				and(eq(repositoriesTable.id, repository.id), eq(repositoriesTable.organizationId, repository.organizationId)),
			);

		return { lastError: error };
	} finally {
		releaseLock();
	}
};

const startDoctor = async (shortId: string) => {
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

const cancelDoctor = async (shortId: string) => {
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

const deleteSnapshot = async (shortId: string, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:${snapshotId}`);
	try {
		await restic.deleteSnapshot(repository.config, snapshotId, organizationId);
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
	} finally {
		releaseLock();
	}
};

const deleteSnapshots = async (shortId: string, snapshotIds: string[]) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:bulk`);
	try {
		await restic.deleteSnapshots(repository.config, snapshotIds, organizationId);
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
	} finally {
		releaseLock();
	}
};

const tagSnapshots = async (
	shortId: string,
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
		await restic.tagSnapshots(repository.config, snapshotIds, tags, organizationId);
		cache.delByPrefix(cacheKeys.repository.all(repository.id));
	} finally {
		releaseLock();
	}
};

const refreshSnapshots = async (shortId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	cache.delByPrefix(cacheKeys.repository.all(repository.id));

	const releaseLock = await repoMutex.acquireShared(repository.id, "refresh");
	try {
		const snapshots = await restic.snapshots(repository.config, { organizationId });
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

const updateRepository = async (shortId: string, updates: UpdateRepositoryBody) => {
	const existing = await findRepository(shortId);

	if (!existing) {
		throw new NotFoundError("Repository not found");
	}

	const existingConfig = repositoryConfigSchema(existing.config);
	if (existingConfig instanceof type.errors) {
		throw new InternalServerError("Invalid repository configuration");
	}

	let newName = existing.name;
	if (updates.name) {
		newName = updates.name.trim();
		if (newName.length === 0) {
			throw new BadRequestError("Repository name cannot be empty");
		}
	}

	let parsedConfig = existingConfig;
	if (updates.config) {
		const nextConfig = repositoryConfigSchema(updates.config);
		if (nextConfig instanceof type.errors) {
			throw new BadRequestError("Invalid repository configuration");
		}

		if (nextConfig.backend !== existing.type) {
			throw new BadRequestError("Repository backend cannot be changed");
		}

		parsedConfig = nextConfig;
	}

	const decryptedExisting = existingConfig ? await decryptConfig(existingConfig) : null;
	const configChanged = updates.config && JSON.stringify(decryptedExisting) !== JSON.stringify(parsedConfig);
	const encryptedConfig = updates.config ? await encryptConfig(parsedConfig) : existingConfig;

	const updatedAt = Date.now();
	const updatePayload = {
		name: newName,
		compressionMode: updates.compressionMode ?? existing.compressionMode,
		updatedAt,
		config: encryptedConfig,
		...(configChanged
			? {
					status: "unknown" as const,
					lastChecked: null,
					lastError: null,
					doctorResult: null,
				}
			: {}),
	};

	const [updated] = await db
		.update(repositoriesTable)
		.set(updatePayload)
		.where(and(eq(repositoriesTable.id, existing.id), eq(repositoriesTable.organizationId, existing.organizationId)))
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update repository");
	}

	if (configChanged) {
		cache.delByPrefix(cacheKeys.repository.all(existing.id));
	}

	return { repository: updated };
};

const unlockRepository = async (shortId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(shortId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "unlock");
	try {
		const result = await restic.unlock(repository.config, { organizationId });
		return result;
	} finally {
		releaseLock();
	}
};

const execResticCommand = async (
	shortId: string,
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
	const env = await buildEnv(repository.config, organizationId);

	const resticArgs: string[] = ["--repo", repoUrl, command];
	if (args && args.length > 0) {
		resticArgs.push(...args);
	}
	addCommonArgs(resticArgs, env, repository.config);

	const result = await safeSpawn({ command: "restic", args: resticArgs, env, signal, onStdout, onStderr });

	await cleanupTemporaryKeys(env);

	return { exitCode: result.exitCode };
};

const getRetentionCategories = async (repositoryId: string, scheduleId?: string) => {
	if (!scheduleId) {
		return new Map<string, RetentionCategory[]>();
	}

	const cacheKey = cacheKeys.repository.retention(repositoryId, scheduleId);
	const cached = cache.get<Record<string, RetentionCategory[]>>(cacheKey);

	if (cached && Object.keys(cached).length > 0) {
		return new Map(Object.entries(cached));
	}

	try {
		const [schedule, repositoryResult] = await Promise.all([
			backupsService.getScheduleByShortId(scheduleId),
			repositoriesService.getRepository(repositoryId),
		]);

		if (!schedule?.retentionPolicy) {
			return new Map<string, RetentionCategory[]>();
		}

		const { repository } = repositoryResult;

		const dryRunResults = await restic.forget(repository.config, schedule.retentionPolicy, {
			tag: scheduleId,
			organizationId: getOrganizationId(),
			dryRun: true,
		});

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
