import { and, eq } from "drizzle-orm";
import { db } from "../../../db/db";
import { repositoriesTable } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";
import { REPOSITORY_BASE } from "~/server/core/constants";
import { repositoryConfigSchema } from "~/schemas/restic";

type MigrationError = { name: string; error: string };

const asString = (value: unknown): string | null => {
	if (typeof value !== "string") {
		return null;
	}

	return value;
};

const hasValue = (value: string | null): value is string => {
	return value !== null && value.trim() !== "";
};

const trimTrailingSlashes = (value: string): string => {
	return value.replace(/\/+$/, "");
};

const isPathAlreadyMigrated = (path: string, name: string): boolean => {
	const normalizedPath = trimTrailingSlashes(path);
	return normalizedPath.endsWith(`/${name}`);
};

const buildPath = (path: string | null, name: string): string => {
	if (path === null || path.trim() === "") {
		return `${REPOSITORY_BASE}/${name}`;
	}

	return `${trimTrailingSlashes(path)}/${name}`;
};

const execute = async () => {
	const errors: MigrationError[] = [];
	const localRepositories = await db.query.repositoriesTable.findMany({ where: { type: "local" } });
	let migratedCount = 0;

	for (const repository of localRepositories) {
		try {
			const config = repository.config as Record<string, unknown>;

			if (typeof config !== "object" || config === null || Array.isArray(config)) {
				errors.push({
					name: `repository:${repository.id}`,
					error: "Repository config is not a valid JSON object",
				});
				continue;
			}

			const localRepositoryName = asString(config.name);

			if (!hasValue(localRepositoryName) || config.isExistingRepository === true) {
				continue;
			}

			const currentPath = asString(config.path);
			if (hasValue(currentPath) && isPathAlreadyMigrated(currentPath, localRepositoryName)) {
				continue;
			}

			config.path = buildPath(currentPath, localRepositoryName);

			const newConfigResult = repositoryConfigSchema.safeParse(config);
			if (!newConfigResult.success) {
				errors.push({
					name: `repository:${repository.id}`,
					error: `Validation failed for updated repository config: ${newConfigResult.error.message}`,
				});
				continue;
			}
			const newConfig = newConfigResult.data;

			await db
				.update(repositoriesTable)
				.set({ config: newConfig, updatedAt: Date.now() })
				.where(and(eq(repositoriesTable.id, repository.id), eq(repositoriesTable.type, "local")));

			migratedCount += 1;
		} catch (err) {
			errors.push({
				name: `repository:${repository.id}`,
				error: toMessage(err),
			});
		}
	}

	logger.info(`Migration 00004-concat-path-name updated ${migratedCount} local repositories.`);

	return { success: errors.length === 0, errors };
};

export const v00004 = {
	execute,
	id: "00004-concat-path-name",
	type: "maintenance" as const,
};
