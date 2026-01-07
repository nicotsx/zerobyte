import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { BadRequestError, ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId, isValidShortId } from "../../utils/id";
import { restic } from "../../utils/restic";
import { cryptoUtils } from "../../utils/crypto";
import { cache } from "../../utils/cache";
import { repoMutex } from "../../core/repository-mutex";
import {
	repositoryConfigSchema,
	type CompressionMode,
	type OverwriteMode,
	type RepositoryConfig,
} from "~/schemas/restic";
import { type } from "arktype";

const findRepository = async (idOrShortId: string) => {
	return await db.query.repositoriesTable.findFirst({
		where: or(eq(repositoriesTable.id, idOrShortId), eq(repositoriesTable.shortId, idOrShortId)),
	});
};

const listRepositories = async () => {
	const repositories = await db.query.repositoriesTable.findMany({});
	return repositories;
};

const encryptConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	const encryptedConfig: Record<string, string | boolean | number> = { ...config };

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

const createRepository = async (
	name: string,
	config: RepositoryConfig,
	compressionMode?: CompressionMode,
	providedShortId?: string,
) => {
	const id = crypto.randomUUID();

	// Use provided shortId if valid, otherwise generate a new one
	let shortId: string;
	if (providedShortId) {
		if (!isValidShortId(providedShortId)) {
			throw new BadRequestError(`Invalid shortId format: '${providedShortId}'. Must be 8 base64url characters.`);
		}
		const shortIdInUse = await db.query.repositoriesTable.findFirst({
			where: eq(repositoriesTable.shortId, providedShortId),
		});
		if (shortIdInUse) {
			throw new ConflictError(
				`Repository shortId '${providedShortId}' is already in use by repository '${shortIdInUse.name}'`,
			);
		}
		shortId = providedShortId;
	} else {
		shortId = generateShortId();
	}

	let processedConfig = config;
	if (config.backend === "local" && !config.isExistingRepository) {
		processedConfig = { ...config, name: shortId };
	}

	const encryptedConfig = await encryptConfig(processedConfig);

	const repoExists = await restic
		.snapshots(encryptedConfig)
		.then(() => true)
		.catch(() => false);

	if (repoExists && !config.isExistingRepository) {
		throw new ConflictError(
			`A restic repository already exists at this location. ` +
				`If you want to use the existing repository, set "isExistingRepository": true in the config.`,
		);
	}

	if (!repoExists && config.isExistingRepository) {
		throw new BadRequestError(
			`Cannot access existing repository. Verify the path/credentials are correct and the repository exists.`,
		);
	}

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
		})
		.returning();

	if (!created) {
		throw new InternalServerError("Failed to create repository");
	}

	let error: string | null = null;

	if (!repoExists) {
		const initResult = await restic.init(encryptedConfig);
		error = initResult.error;
	}

	if (!error) {
		await db
			.update(repositoriesTable)
			.set({ status: "healthy", lastChecked: Date.now(), lastError: null })
			.where(eq(repositoriesTable.id, id));

		return { repository: created, status: 201 };
	}

	const errorMessage = toMessage(error);
	await db.delete(repositoriesTable).where(eq(repositoriesTable.id, id));

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

	await db.delete(repositoriesTable).where(eq(repositoriesTable.id, repository.id));

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
			snapshots = await restic.snapshots(repository.config, { tags: [backupId] });
		} else {
			snapshots = await restic.snapshots(repository.config);
		}

		cache.set(cacheKey, snapshots);

		return snapshots;
	} finally {
		releaseLock();
	}
};

const listSnapshotFiles = async (id: string, snapshotId: string, path?: string) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = `ls:${repository.id}:${snapshotId}:${path || "root"}`;
	const cached = cache.get<Awaited<ReturnType<typeof restic.ls>>>(cacheKey);
	if (cached?.snapshot) {
		return {
			snapshot: cached.snapshot,
			files: cached.nodes,
		};
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `ls:${snapshotId}`);
	try {
		const result = await restic.ls(repository.config, snapshotId, path);

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
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const target = options?.targetPath || "/";

	const releaseLock = await repoMutex.acquireShared(repository.id, `restore:${snapshotId}`);
	try {
		const result = await restic.restore(repository.config, snapshotId, target, options);

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
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const cacheKey = `snapshots:${repository.id}:all`;
	let snapshots = cache.get<Awaited<ReturnType<typeof restic.snapshots>>>(cacheKey);

	if (!snapshots) {
		const releaseLock = await repoMutex.acquireShared(repository.id, `snapshot_details:${snapshotId}`);
		try {
			snapshots = await restic.snapshots(repository.config);
			cache.set(cacheKey, snapshots);
		} finally {
			releaseLock();
		}
	}

	const snapshot = snapshots.find((snap) => snap.id === snapshotId || snap.short_id === snapshotId);

	if (!snapshot) {
		throw new NotFoundError("Snapshot not found");
	}

	return snapshot;
};

const checkHealth = async (repositoryId: string) => {
	const repository = await findRepository(repositoryId);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "check");
	try {
		const { hasErrors, error } = await restic.check(repository.config);

		await db
			.update(repositoriesTable)
			.set({
				status: hasErrors ? "error" : "healthy",
				lastChecked: Date.now(),
				lastError: error,
			})
			.where(eq(repositoriesTable.id, repository.id));

		return { lastError: error };
	} finally {
		releaseLock();
	}
};

const doctorRepository = async (id: string) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const steps: Array<{ step: string; success: boolean; output: string | null; error: string | null }> = [];

	const unlockResult = await restic.unlock(repository.config).then(
		(result) => ({ success: true, message: result.message, error: null }),
		(error) => ({ success: false, message: null, error: toMessage(error) }),
	);

	steps.push({
		step: "unlock",
		success: unlockResult.success,
		output: unlockResult.message,
		error: unlockResult.error,
	});

	const releaseLock = await repoMutex.acquireExclusive(repository.id, "doctor");
	try {
		const checkResult = await restic.check(repository.config, { readData: false }).then(
			(result) => result,
			(error) => ({ success: false, output: null, error: toMessage(error), hasErrors: true }),
		);

		steps.push({
			step: "check",
			success: checkResult.success,
			output: checkResult.output,
			error: checkResult.error,
		});

		if (checkResult.hasErrors) {
			const repairResult = await restic.repairIndex(repository.config).then(
				(result) => ({ success: true, output: result.output, error: null }),
				(error) => ({ success: false, output: null, error: toMessage(error) }),
			);

			steps.push({
				step: "repair_index",
				success: repairResult.success,
				output: repairResult.output,
				error: repairResult.error,
			});

			const recheckResult = await restic.check(repository.config, { readData: false }).then(
				(result) => result,
				(error) => ({ success: false, output: null, error: toMessage(error), hasErrors: true }),
			);

			steps.push({
				step: "recheck",
				success: recheckResult.success,
				output: recheckResult.output,
				error: recheckResult.error,
			});
		}
	} catch (error) {
		steps.push({
			step: "unexpected_error",
			success: false,
			output: null,
			error: toMessage(error),
		});
	} finally {
		releaseLock();
	}

	const doctorSucceeded = steps.every((step) => step.success);
	const doctorError = steps.find((step) => step.error)?.error ?? null;

	await db
		.update(repositoriesTable)
		.set({
			status: doctorSucceeded ? "healthy" : "error",
			lastChecked: Date.now(),
			lastError: doctorError,
		})
		.where(eq(repositoriesTable.id, repository.id));

	return {
		success: doctorSucceeded,
		steps,
	};
};

const deleteSnapshot = async (id: string, snapshotId: string) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:${snapshotId}`);
	try {
		await restic.deleteSnapshot(repository.config, snapshotId);
		cache.delByPrefix(`snapshots:${repository.id}:`);
		cache.delByPrefix(`ls:${repository.id}:${snapshotId}:`);
	} finally {
		releaseLock();
	}
};

const deleteSnapshots = async (id: string, snapshotIds: string[]) => {
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:bulk`);
	try {
		await restic.deleteSnapshots(repository.config, snapshotIds);
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
	const repository = await findRepository(id);

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `tag:bulk`);
	try {
		await restic.tagSnapshots(repository.config, snapshotIds, tags);
		cache.delByPrefix(`snapshots:${repository.id}:`);
		for (const snapshotId of snapshotIds) {
			cache.delByPrefix(`ls:${repository.id}:${snapshotId}:`);
		}
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
	doctorRepository,
	deleteSnapshot,
	deleteSnapshots,
	tagSnapshots,
};
