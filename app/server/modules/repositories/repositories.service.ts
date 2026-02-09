import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { restic, buildEnv, buildRepoUrl, addCommonArgs, cleanupTemporaryKeys } from "../../utils/restic";
import { safeSpawn } from "../../utils/spawn";
import { cryptoUtils } from "../../utils/crypto";
import { cache } from "../../utils/cache";
import { repoMutex } from "../../core/repository-mutex";
import { type } from "arktype";
import {
	repositoryConfigSchema,
	type CompressionMode,
	type OverwriteMode,
	type RepositoryConfig,
} from "~/schemas/restic";
import { getOrganizationId } from "~/server/core/request-context";
import { serverEvents } from "~/server/core/events";
import { executeDoctor } from "./doctor";
import { logger } from "~/server/utils/logger";

const runningDoctors = new Map<string, AbortController>();

const findRepository = async (idOrShortId: string) => {
	const organizationId = getOrganizationId();
	return await db.query.repositoriesTable.findFirst({
		where: {
			AND: [{ OR: [{ id: idOrShortId }, { shortId: idOrShortId }] }, { organizationId }],
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

const createRepository = async (name: string, config: RepositoryConfig, compressionMode?: CompressionMode) => {
	const organizationId = getOrganizationId();
	const id = crypto.randomUUID();
	const shortId = generateShortId();

	let processedConfig = config;
	if (config.backend === "local" && !config.isExistingRepository) {
		processedConfig = { ...config, name: shortId };
	}

	const encryptedConfig = await encryptConfig(processedConfig);

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

const getRepository = async (id: string) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return { repository };
};

const deleteRepository = async (id: string) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	// TODO: Add cleanup logic for the actual restic repository files

	await db
		.delete(repositoriesTable)
		.where(
			and(eq(repositoriesTable.id, repository.id), eq(repositoriesTable.organizationId, repository.organizationId)),
		);

	cache.delByPrefix(`snapshots:${repository.id}:`);
	cache.delByPrefix(`ls:${repository.id}:`);
};

/**
 * List snapshots for a given repository
 * If backupId is provided, filter snapshots by that backup ID (tag)
 * @param id Repository ID
 * @param backupId Optional backup ID to filter snapshots for a specific backup schedule
 *
 * @returns List of snapshots
 */
const listSnapshots = async (id: string, backupId?: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = `snapshots:${repository.id}:${backupId || "all"}`;
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
	id: string,
	snapshotId: string,
	path?: string,
	options?: { offset?: number; limit?: number },
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const offset = options?.offset ?? 0;
	const limit = options?.limit ?? 500;

	const cacheKey = `ls:${repository.id}:${snapshotId}:${path || "root"}:${offset}:${limit}`;
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
	id: string,
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
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const target = options?.targetPath || "/";

	const releaseLock = await repoMutex.acquireShared(repository.id, `restore:${snapshotId}`);
	try {
		const result = await restic.restore(repository.config, snapshotId, target, { ...options, organizationId });

		return {
			success: true,
			message: "Snapshot restored successfully",
			filesRestored: result.files_restored,
			filesSkipped: result.files_skipped,
		};
	} finally {
		releaseLock();
	}
};

const getSnapshotDetails = async (id: string, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = `snapshots:${repository.id}:all`;
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
		void refreshSnapshots(id).catch(() => {});

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

const startDoctor = async (id: string) => {
	const repository = await findRepository(id);

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
			repositoryId: repository.id,
			repositoryName: repository.name,
		});

		runningDoctors.set(repository.id, abortController);
	} catch (error) {
		runningDoctors.delete(repository.id);
		throw error;
	}

	executeDoctor(repository.id, repository.config, repository.name, abortController.signal)
		.catch((error) => {
			logger.error(`Doctor background task failed: ${toMessage(error)}`);
		})
		.finally(() => {
			runningDoctors.delete(repository.id);
		});

	return { message: "Doctor operation started", repositoryId: repository.id };
};

const cancelDoctor = async (id: string) => {
	const repository = await findRepository(id);

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
		repositoryId: repository.id,
		repositoryName: repository.name,
	});

	return { message: "Doctor operation cancelled" };
};

const deleteSnapshot = async (id: string, snapshotId: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:${snapshotId}`);
	try {
		await restic.deleteSnapshot(repository.config, snapshotId, organizationId);
		cache.delByPrefix(`snapshots:${repository.id}:`);
		cache.delByPrefix(`ls:${repository.id}:${snapshotId}:`);
	} finally {
		releaseLock();
	}
};

const deleteSnapshots = async (id: string, snapshotIds: string[]) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:bulk`);
	try {
		await restic.deleteSnapshots(repository.config, snapshotIds, organizationId);
		cache.delByPrefix(`snapshots:${repository.id}:`);
		for (const snapshotId of snapshotIds) {
			cache.delByPrefix(`ls:${repository.id}:${snapshotId}:`);
		}
	} finally {
		releaseLock();
	}
};

const tagSnapshots = async (
	id: string,
	snapshotIds: string[],
	tags: { add?: string[]; remove?: string[]; set?: string[] },
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `tag:bulk`);
	try {
		await restic.tagSnapshots(repository.config, snapshotIds, tags, organizationId);
		cache.delByPrefix(`snapshots:${repository.id}:`);
		for (const snapshotId of snapshotIds) {
			cache.delByPrefix(`ls:${repository.id}:${snapshotId}:`);
		}
	} finally {
		releaseLock();
	}
};

const refreshSnapshots = async (id: string) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	cache.delByPrefix(`snapshots:${repository.id}:`);
	cache.delByPrefix(`ls:${repository.id}:`);

	const releaseLock = await repoMutex.acquireShared(repository.id, "refresh");
	try {
		const snapshots = await restic.snapshots(repository.config, { organizationId });
		const cacheKey = `snapshots:${repository.id}:all`;
		cache.set(cacheKey, snapshots);

		return {
			message: "Snapshot cache cleared and refreshed",
			count: snapshots.length,
		};
	} finally {
		releaseLock();
	}
};

const updateRepository = async (id: string, updates: { name?: string; compressionMode?: CompressionMode }) => {
	const existing = await findRepository(id);

	if (!existing) {
		throw new NotFoundError("Repository not found");
	}

	const newConfig = repositoryConfigSchema(existing.config);
	if (newConfig instanceof type.errors) {
		throw new InternalServerError("Invalid repository configuration");
	}

	const encryptedConfig = await encryptConfig(newConfig);

	let newName = existing.name;
	if (updates.name !== undefined && updates.name !== existing.name) {
		newName = updates.name.trim();
	}

	const [updated] = await db
		.update(repositoriesTable)
		.set({
			name: newName,
			compressionMode: updates.compressionMode ?? existing.compressionMode,
			updatedAt: Date.now(),
			config: encryptedConfig,
		})
		.where(eq(repositoriesTable.id, existing.id))
		.returning();

	if (!updated) {
		throw new InternalServerError("Failed to update repository");
	}

	return { repository: updated };
};

const execResticCommand = async (
	id: string,
	command: string,
	args: string[] | undefined,
	onStdout: (line: string) => void,
	onStderr: (line: string) => void,
	signal?: AbortSignal,
) => {
	const organizationId = getOrganizationId();
	const repository = await findRepository(id);

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

export const repositoriesService = {
	listRepositories,
	createRepository,
	getRepository,
	deleteRepository,
	updateRepository,
	listSnapshots,
	listSnapshotFiles,
	restoreSnapshot,
	getSnapshotDetails,
	checkHealth,
	startDoctor,
	cancelDoctor,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
	refreshSnapshots,
	execResticCommand,
};
