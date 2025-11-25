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

export const migrateToShortIds = async () => {
	const alreadyMigrated = await hasMigrationCheckpoint(MIGRATION_VERSION);
	if (alreadyMigrated) {
		logger.debug(`Migration ${MIGRATION_VERSION} already completed, skipping.`);
		return;
	}

	logger.info(`Starting short ID migration (${MIGRATION_VERSION})...`);

	await migrateVolumeFolders();
	await migrateRepositoryFolders();

	await recordMigrationCheckpoint(MIGRATION_VERSION);

	logger.info(`Short ID migration (${MIGRATION_VERSION}) complete.`);
};

const migrateVolumeFolders = async () => {
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
				logger.error(`Failed to migrate volume folder for "${volume.name}": ${error}`);
			}
		} else if (oldExists && newExists) {
			logger.warn(
				`Both old (${oldPath}) and new (${newPath}) paths exist for volume "${volume.name}". Manual intervention may be required.`,
			);
		}
	}
};

const migrateRepositoryFolders = async () => {
	const repositories = await db.query.repositoriesTable.findMany({});

	for (const repo of repositories) {
		if (repo.config.backend !== "local") {
			continue;
		}

		const config = repo.config as Extract<RepositoryConfig, { backend: "local" }>;

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
						updatedAt: Math.floor(Date.now() / 1000),
					})
					.where(eq(repositoriesTable.id, repo.id));

				logger.info(`Successfully migrated repository folder and config for "${repo.name}"`);
			} catch (error) {
				logger.error(`Failed to migrate repository folder for "${repo.name}": ${error}`);
			}
		} else if (oldExists && newExists) {
			logger.warn(
				`Both old (${oldPath}) and new (${newPath}) paths exist for repository "${repo.name}". Manual intervention may be required.`,
			);
		} else if (!oldExists && !newExists) {
			logger.info(`Updating config.name for repository "${repo.name}" (no folder exists yet)`);

			const updatedConfig: RepositoryConfig = {
				...config,
				name: repo.shortId,
			};

			await db
				.update(repositoriesTable)
				.set({
					config: updatedConfig,
					updatedAt: Math.floor(Date.now() / 1000),
				})
				.where(eq(repositoriesTable.id, repo.id));
		} else if (newExists && !oldExists && config.name !== repo.shortId) {
			logger.info(`Folder already at new path, updating config.name for repository "${repo.name}"`);

			const updatedConfig: RepositoryConfig = {
				...config,
				name: repo.shortId,
			};

			await db
				.update(repositoriesTable)
				.set({
					config: updatedConfig,
					updatedAt: Math.floor(Date.now() / 1000),
				})
				.where(eq(repositoriesTable.id, repo.id));
		}
	}
};

const pathExists = async (p: string): Promise<boolean> => {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
};
