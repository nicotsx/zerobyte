import { and, eq } from "drizzle-orm";
import { db } from "../../../db/db";
import { repositoriesTable } from "../../../db/schema";
import { logger } from "../../../utils/logger";
import { toMessage } from "~/server/utils/errors";

const DEFAULT_LOCAL_REPOSITORY_ROOT = "/var/lib/zerobyte/repositories";

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
		return `${DEFAULT_LOCAL_REPOSITORY_ROOT}/${name}`;
	}

	return `${trimTrailingSlashes(path)}/${name}`;
};

const execute = async () => {
	const errors: MigrationError[] = [];
	const localRepositories = await db.query.repositoriesTable.findMany({ where: { type: "local" } });
	let migratedCount = 0;

	for (const repository of localRepositories) {
		try {
			const configValue = repository.config as unknown;

			if (typeof configValue !== "object" || configValue === null || Array.isArray(configValue)) {
				errors.push({
					name: `repository:${repository.id}`,
					error: "Repository config is not a valid JSON object",
				});
				continue;
			}

			const config = { ...(configValue as Record<string, unknown>) };
			const localRepositoryName = asString(config.name);

			if (!hasValue(localRepositoryName)) {
				continue;
			}

			const currentPath = asString(config.path);
			if (hasValue(currentPath) && isPathAlreadyMigrated(currentPath, localRepositoryName)) {
				continue;
			}

			config.path = buildPath(currentPath, localRepositoryName);

			await db
				.update(repositoriesTable)
				.set({
					config: config as typeof repository.config,
					updatedAt: Date.now(),
				})
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
