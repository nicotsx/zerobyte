import crypto from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { ConflictError, InternalServerError, NotFoundError } from "http-errors-enhanced";
import slugify from "slugify";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { toMessage } from "../../utils/errors";
import { generateShortId } from "../../utils/id";
import { restic } from "../../utils/restic";
import { cryptoUtils } from "../../utils/crypto";
import { repoMutex } from "../../core/repository-mutex";
import type { CompressionMode, OverwriteMode, RepositoryConfig } from "~/schemas/restic";

const listRepositories = async () => {
	const repositories = await db.query.repositoriesTable.findMany({});
	return repositories;
};

const encryptConfig = async (config: RepositoryConfig): Promise<RepositoryConfig> => {
	const encryptedConfig: Record<string, string | boolean | number> = { ...config };

	if (config.customPassword) {
		encryptedConfig.customPassword = await cryptoUtils.encrypt(config.customPassword);
	}

	switch (config.backend) {
		case "s3":
		case "r2":
			encryptedConfig.accessKeyId = await cryptoUtils.encrypt(config.accessKeyId);
			encryptedConfig.secretAccessKey = await cryptoUtils.encrypt(config.secretAccessKey);
			break;
		case "gcs":
			encryptedConfig.credentialsJson = await cryptoUtils.encrypt(config.credentialsJson);
			break;
		case "azure":
			encryptedConfig.accountKey = await cryptoUtils.encrypt(config.accountKey);
			break;
		case "rest":
			if (config.username) {
				encryptedConfig.username = await cryptoUtils.encrypt(config.username);
			}
			if (config.password) {
				encryptedConfig.password = await cryptoUtils.encrypt(config.password);
			}
			break;
		case "sftp":
			encryptedConfig.privateKey = await cryptoUtils.encrypt(config.privateKey);
			break;
	}

	return encryptedConfig as RepositoryConfig;
};

const createRepository = async (name: string, config: RepositoryConfig, compressionMode?: CompressionMode) => {
	const slug = slugify(name, { lower: true, strict: true });

	const existing = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, slug),
	});

	if (existing) {
		throw new ConflictError("Repository with this name already exists");
	}

	const id = crypto.randomUUID();
	const shortId = generateShortId();

	let processedConfig = config;
	if (config.backend === "local") {
		processedConfig = { ...config, name: shortId };
	}

	const encryptedConfig = await encryptConfig(processedConfig);

	const [created] = await db
		.insert(repositoriesTable)
		.values({
			id,
			shortId,
			name: slug,
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

	if (config.isExistingRepository) {
		const result = await restic
			.snapshots(encryptedConfig)
			.then(() => ({ error: null }))
			.catch((error) => ({ error }));

		error = result.error;
	} else {
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

const getRepository = async (name: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	return { repository };
};

const deleteRepository = async (name: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	// TODO: Add cleanup logic for the actual restic repository files

	await db.delete(repositoriesTable).where(eq(repositoriesTable.name, name));
};

/**
 * List snapshots for a given repository
 * If backupId is provided, filter snapshots by that backup ID (tag)
 * @param name Repository name
 * @param backupId Optional backup ID to filter snapshots for a specific backup schedule
 *
 * @returns List of snapshots
 */
const listSnapshots = async (name: string, backupId?: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, "snapshots");
	try {
		let snapshots = [];

		if (backupId) {
			snapshots = await restic.snapshots(repository.config, { tags: [backupId.toString()] });
		} else {
			snapshots = await restic.snapshots(repository.config);
		}

		return snapshots;
	} finally {
		releaseLock();
	}
};

const listSnapshotFiles = async (name: string, snapshotId: string, path?: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `ls:${snapshotId}`);
	try {
		const result = await restic.ls(repository.config, snapshotId, path);

		if (!result.snapshot) {
			throw new NotFoundError("Snapshot not found or empty");
		}

		return {
			snapshot: {
				id: result.snapshot.id,
				short_id: result.snapshot.short_id,
				time: result.snapshot.time,
				hostname: result.snapshot.hostname,
				paths: result.snapshot.paths,
			},
			files: result.nodes,
		};
	} finally {
		releaseLock();
	}
};

const restoreSnapshot = async (
	name: string,
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
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

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

const getSnapshotDetails = async (name: string, snapshotId: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireShared(repository.id, `snapshot_details:${snapshotId}`);
	try {
		const snapshots = await restic.snapshots(repository.config);
		const snapshot = snapshots.find((snap) => snap.id === snapshotId || snap.short_id === snapshotId);

		if (!snapshot) {
			throw new NotFoundError("Snapshot not found");
		}

		return snapshot;
	} finally {
		releaseLock();
	}
};

const checkHealth = async (repositoryId: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.id, repositoryId),
	});

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

const doctorRepository = async (name: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

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
	} finally {
		releaseLock();
	}

	const allSuccessful = steps.every((s) => s.success);

	await db
		.update(repositoriesTable)
		.set({
			status: allSuccessful ? "healthy" : "error",
			lastChecked: Date.now(),
			lastError: allSuccessful ? null : steps.find((s) => !s.success)?.error,
		})
		.where(eq(repositoriesTable.id, repository.id));

	return {
		success: allSuccessful,
		steps,
	};
};

const deleteSnapshot = async (name: string, snapshotId: string) => {
	const repository = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!repository) {
		throw new NotFoundError("Repository not found");
	}

	const releaseLock = await repoMutex.acquireExclusive(repository.id, `delete:${snapshotId}`);
	try {
		await restic.deleteSnapshot(repository.config, snapshotId);
	} finally {
		releaseLock();
	}
};

const updateRepository = async (name: string, updates: { name?: string; compressionMode?: CompressionMode }) => {
	const existing = await db.query.repositoriesTable.findFirst({
		where: eq(repositoriesTable.name, name),
	});

	if (!existing) {
		throw new NotFoundError("Repository not found");
	}

	if (
		updates.name !== undefined &&
		updates.name !== existing.name &&
		existing.config.backend === "local" &&
		existing.config.isExistingRepository
	) {
		throw new ConflictError("Cannot rename an imported local repository");
	}

	let newName = existing.name;
	if (updates.name !== undefined && updates.name !== existing.name) {
		const newSlug = slugify(updates.name, { lower: true, strict: true });

		const conflict = await db.query.repositoriesTable.findFirst({
			where: and(eq(repositoriesTable.name, newSlug), ne(repositoriesTable.id, existing.id)),
		});

		if (conflict) {
			throw new ConflictError("A repository with this name already exists");
		}

		newName = newSlug;
	}

	const [updated] = await db
		.update(repositoriesTable)
		.set({
			name: newName,
			compressionMode: updates.compressionMode ?? existing.compressionMode,
			updatedAt: Date.now(),
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
};
