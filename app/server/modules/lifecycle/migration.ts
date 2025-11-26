import * as fs from "node:fs/promises";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db/db";
import { repositoriesTable } from "../../db/schema";
import { VOLUME_MOUNT_BASE, REPOSITORY_BASE } from "../../core/constants";
import { logger } from "../../utils/logger";
import { hasMigrationCheckpoint, recordMigrationCheckpoint } from "./checkpoint";
import type { RepositoryConfig } from "~/schemas/restic";

const MIGRATION_VERSION = "v0.14.0";

interface MigrationResult {
	success: boolean;
	errors: Array<{ name: string; error: string }>;
}

export class MigrationError extends Error {
	version: string;
	failedItems: Array<{ name: string; error: string }>;

	constructor(version: string, failedItems: Array<{ name: string; error: string }>) {
		const itemNames = failedItems.map((e) => e.name).join(", ");
		super(`Migration ${version} failed for: ${itemNames}`);
		this.version = version;
		this.failedItems = failedItems;
		this.name = "MigrationError";
	}
}

export const migrateToShortIds = async () => {
	const alreadyMigrated = await hasMigrationCheckpoint(MIGRATION_VERSION);
	if (alreadyMigrated) {
		logger.debug(`Migration ${MIGRATION_VERSION} already completed, skipping.`);
		return;
	}

	logger.info(`Starting short ID migration (${MIGRATION_VERSION})...`);

	const volumeResult = await migrateVolumeFolders();
	const repoResult = await migrateRepositoryFolders();

	const allErrors = [...volumeResult.errors, ...repoResult.errors];

	if (allErrors.length > 0) {
		for (const err of allErrors) {
			logger.error(`Migration failure - ${err.name}: ${err.error}`);
		}
		throw new MigrationError(MIGRATION_VERSION, allErrors);
	}

	await recordMigrationCheckpoint(MIGRATION_VERSION);

	logger.info(`Short ID migration (${MIGRATION_VERSION}) complete.`);
};

const migrateVolumeFolders = async (): Promise<MigrationResult> => {
	const errors: Array<{ name: string; error: string }> = [];
	const volumes = await db.query.volumesTable.findMany({});

	for (const volume of volumes) {
		if (volume.config.backend === "directory") {
			continue;
		}

		const oldPath = path.join(VOLUME_MOUNT_BASE, volume.name);
		const newPath = path.join(VOLUME_MOUNT_BASE, volume.shortId);

		const oldExists = await pathExists(oldPath);
		const newExists = await pathExists(newPath);

		if (oldExists && !newExists) {
			try {
				logger.info(`Migrating volume folder: ${oldPath} -> ${newPath}`);
				await fs.rename(oldPath, newPath);
				logger.info(`Successfully migrated volume folder for "${volume.name}"`);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push({ name: `volume:${volume.name}`, error: errorMessage });
			}
		} else if (oldExists && newExists) {
			logger.warn(
				`Both old (${oldPath}) and new (${newPath}) paths exist for volume "${volume.name}". Manual intervention may be required.`,
			);
		}
	}

	return { success: errors.length === 0, errors };
};

const migrateRepositoryFolders = async (): Promise<MigrationResult> => {
	const errors: Array<{ name: string; error: string }> = [];
	const repositories = await db.query.repositoriesTable.findMany({});

	for (const repo of repositories) {
		if (repo.config.backend !== "local") {
			continue;
		}

		const config = repo.config as Extract<RepositoryConfig, { backend: "local" }>;

		if (config.isExistingRepository) {
			logger.debug(`Skipping imported repository "${repo.name}" - folder path is user-defined`);
			continue;
		}

		if (config.name === repo.shortId) {
			continue;
		}

		const basePath = config.path || REPOSITORY_BASE;
		const oldPath = path.join(basePath, config.name);
		const newPath = path.join(basePath, repo.shortId);

		const oldExists = await pathExists(oldPath);
		const newExists = await pathExists(newPath);

		if (oldExists && !newExists) {
			try {
				logger.info(`Migrating repository folder: ${oldPath} -> ${newPath}`);
				await fs.rename(oldPath, newPath);

				const updatedConfig: RepositoryConfig = {
					...config,
					name: repo.shortId,
				};

				await db
					.update(repositoriesTable)
					.set({
						config: updatedConfig,
						updatedAt: Date.now(),
					})
					.where(eq(repositoriesTable.id, repo.id));

				logger.info(`Successfully migrated repository folder and config for "${repo.name}"`);
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push({ name: `repository:${repo.name}`, error: errorMessage });
			}
		} else if (oldExists && newExists) {
			logger.warn(
				`Both old (${oldPath}) and new (${newPath}) paths exist for repository "${repo.name}". Manual intervention may be required.`,
			);
		} else if (!oldExists && !newExists) {
			try {
				logger.info(`Updating config.name for repository "${repo.name}" (no folder exists yet)`);

				const updatedConfig: RepositoryConfig = {
					...config,
					name: repo.shortId,
				};

				await db
					.update(repositoriesTable)
					.set({
						config: updatedConfig,
						updatedAt: Date.now(),
					})
					.where(eq(repositoriesTable.id, repo.id));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push({ name: `repository:${repo.name}`, error: errorMessage });
			}
		} else if (newExists && !oldExists && config.name !== repo.shortId) {
			try {
				logger.info(`Folder already at new path, updating config.name for repository "${repo.name}"`);

				const updatedConfig: RepositoryConfig = {
					...config,
					name: repo.shortId,
				};

				await db
					.update(repositoriesTable)
					.set({
						config: updatedConfig,
						updatedAt: Date.now(),
					})
					.where(eq(repositoriesTable.id, repo.id));
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				errors.push({ name: `repository:${repo.name}`, error: errorMessage });
			}
		}
	}

	return { success: errors.length === 0, errors };
};

const pathExists = async (p: string): Promise<boolean> => {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
};
