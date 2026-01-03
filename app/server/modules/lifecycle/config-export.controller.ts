import { validator } from "hono-openapi";
import { Hono } from "hono";
import type { Context } from "hono";
import {
	type backupSchedulesTable,
	backupScheduleNotificationsTable,
	backupScheduleMirrorsTable,
	usersTable,
} from "../../db/schema";
import { db } from "../../db/db";
import { logger } from "../../utils/logger";
import { RESTIC_PASS_FILE, REPOSITORY_BASE } from "../../core/constants";
import { cryptoUtils } from "../../utils/crypto";
import { authService } from "../auth/auth.service";
import { volumeService } from "../volumes/volume.service";
import { repositoriesService } from "../repositories/repositories.service";
import { notificationsService } from "../notifications/notifications.service";
import { backupsService } from "../backups/backups.service";
import { fullExportBodySchema, fullExportDto, type SecretsMode, type FullExportBody } from "./config-export.dto";
import { requireAuth } from "../auth/auth.middleware";

type ExportParams = {
	includeMetadata: boolean;
	secretsMode: SecretsMode;
};

// Keys to exclude when metadata is not included
const METADATA_KEYS = {
	ids: ["id", "volumeId", "repositoryId", "scheduleId", "destinationId"],
	timestamps: [
		"createdAt",
		"updatedAt",
		"lastBackupAt",
		"nextBackupAt",
		"lastHealthCheck",
		"lastChecked",
		"lastCopyAt",
	],
	runtimeState: [
		"status",
		"lastError",
		"lastBackupStatus",
		"lastBackupError",
		"hasDownloadedResticPassword",
		"lastCopyStatus",
		"lastCopyError",
		"sortOrder",
	],
};

const ALL_METADATA_KEYS = [...METADATA_KEYS.ids, ...METADATA_KEYS.timestamps, ...METADATA_KEYS.runtimeState];

/** Filter out metadata keys from an object when includeMetadata is false */
function filterMetadataOut<T extends Record<string, unknown>>(obj: T, includeMetadata: boolean): Partial<T> {
	if (includeMetadata) {
		return obj;
	}
	const result = { ...obj };
	for (const key of ALL_METADATA_KEYS) {
		delete result[key as keyof T];
	}
	return result;
}

/** Parse export params from request body */
function parseExportParamsFromBody(body: { includeMetadata?: boolean; secretsMode?: SecretsMode }): ExportParams {
	const includeMetadata = body.includeMetadata === true;
	const secretsMode: SecretsMode = body.secretsMode ?? "exclude";
	return { includeMetadata, secretsMode };
}

/**
 * Verify password for export operation.
 * Requires requireAuth middleware to have already validated the session.
 */
async function verifyExportPassword(
	c: Context,
	password: string,
): Promise<{ valid: true; userId: number } | { valid: false; error: string }> {
	// requireAuth middleware ensures c.get('user') exists
	const user = c.get("user");
	if (!user) {
		return { valid: false, error: "Not authenticated" };
	}

	const isValid = await authService.verifyPassword(user.id, password);
	if (!isValid) {
		return { valid: false, error: "Incorrect password" };
	}

	return { valid: true, userId: user.id };
}

/**
 * Process secrets in an object based on the secrets mode.
 * Automatically detects encrypted fields using cryptoUtils.isEncrypted.
 */
async function processSecrets(
	obj: Record<string, unknown>,
	secretsMode: SecretsMode,
): Promise<Record<string, unknown>> {
	if (secretsMode === "encrypted") {
		return obj;
	}

	const result = { ...obj };

	for (const [key, value] of Object.entries(result)) {
		if (typeof value === "string" && cryptoUtils.isEncrypted(value)) {
			if (secretsMode === "exclude") {
				delete result[key];
			} else if (secretsMode === "cleartext") {
				try {
					result[key] = await cryptoUtils.decrypt(value);
				} catch (err) {
					logger.warn(`Failed to decrypt field "${key}": ${err instanceof Error ? err.message : String(err)}`);
					delete result[key];
				}
			}
		} else if (Array.isArray(value)) {
			result[key] = await Promise.all(
				value.map(async (item) =>
					item && typeof item === "object" && !Array.isArray(item)
						? processSecrets(item as Record<string, unknown>, secretsMode)
						: item,
				),
			);
		} else if (value && typeof value === "object") {
			result[key] = await processSecrets(value as Record<string, unknown>, secretsMode);
		}
	}

	return result;
}

/** Clean and process an entity for export */
async function exportEntity(entity: Record<string, unknown>, params: ExportParams): Promise<Record<string, unknown>> {
	const cleaned = filterMetadataOut(entity, params.includeMetadata);
	return processSecrets(cleaned, params.secretsMode);
}

/** Export multiple entities */
async function exportEntities<T extends Record<string, unknown>>(
	entities: T[],
	params: ExportParams,
): Promise<Record<string, unknown>[]> {
	return Promise.all(entities.map((e) => exportEntity(e as Record<string, unknown>, params)));
}

/** Transform backup schedules with resolved names, notifications, and mirrors */
function transformBackupSchedules(
	schedules: (typeof backupSchedulesTable.$inferSelect)[],
	scheduleNotifications: (typeof backupScheduleNotificationsTable.$inferSelect)[],
	scheduleMirrors: (typeof backupScheduleMirrorsTable.$inferSelect)[],
	volumeMap: Map<number, string>,
	repoMap: Map<string, string>,
	notificationMap: Map<number, string>,
	params: ExportParams,
) {
	return schedules.map((schedule) => {
		const assignments = scheduleNotifications
			.filter((sn) => sn.scheduleId === schedule.id)
			.map((sn) => ({
				...filterMetadataOut(sn as unknown as Record<string, unknown>, params.includeMetadata),
				name: notificationMap.get(sn.destinationId) ?? null,
			}));

		const mirrors = scheduleMirrors
			.filter((sm) => sm.scheduleId === schedule.id)
			.map((sm) => ({
				...filterMetadataOut(sm as unknown as Record<string, unknown>, params.includeMetadata),
				repository: repoMap.get(sm.repositoryId) ?? null,
			}));

		return {
			...filterMetadataOut(schedule as Record<string, unknown>, params.includeMetadata),
			volume: volumeMap.get(schedule.volumeId) ?? null,
			repository: repoMap.get(schedule.repositoryId) ?? null,
			notifications: assignments,
			mirrors,
		};
	});
}

export const configExportController = new Hono()
	.use(requireAuth)
	.post("/export", fullExportDto, validator("json", fullExportBodySchema), async (c) => {
		try {
			const body = c.req.valid("json") as FullExportBody;

			// Verify password - required for all exports
			const verification = await verifyExportPassword(c, body.password);
			if (!verification.valid) {
				return c.json({ error: verification.error }, 401);
			}

			const params = parseExportParamsFromBody(body);
			const includeRecoveryKey = body.includeRecoveryKey === true;
			const includePasswordHash = body.includePasswordHash === true;

			// Use services to fetch data
			const [volumes, repositories, backupSchedulesRaw, notifications, scheduleNotifications, scheduleMirrors, users] =
				await Promise.all([
					volumeService.listVolumes(),
					repositoriesService.listRepositories(),
					backupsService.listSchedules(),
					notificationsService.listDestinations(),
					db.select().from(backupScheduleNotificationsTable),
					db.select().from(backupScheduleMirrorsTable),
					db.select().from(usersTable),
				]);

			const volumeMap = new Map<number, string>(volumes.map((v) => [v.id, v.name]));
			const repoMap = new Map<string, string>(repositories.map((r) => [r.id, r.name]));
			const notificationMap = new Map<number, string>(notifications.map((n) => [n.id, n.name]));

			const backupSchedules = transformBackupSchedules(
				backupSchedulesRaw,
				scheduleNotifications,
				scheduleMirrors,
				volumeMap,
				repoMap,
				notificationMap,
				params,
			);

			const [exportVolumes, exportRepositoriesRaw, exportNotifications] = await Promise.all([
				exportEntities(volumes, params),
				exportEntities(repositories, params),
				exportEntities(notifications, params),
			]);

			// Add isExistingRepository flag and path to all repository configs for import compatibility
			const exportRepositories = exportRepositoriesRaw.map((repo) => {
				if (!repo.config || typeof repo.config !== "object") {
					return repo;
				}

				const config = repo.config as Record<string, unknown>;
				const updatedConfig: Record<string, unknown> = { ...config, isExistingRepository: true };

				// For local repos, compute and add the full path if not already present
				if (config.backend === "local" && !config.path && typeof config.name === "string") {
					updatedConfig.path = `${REPOSITORY_BASE}/${config.name}`;
				}

				return { ...repo, config: updatedConfig };
			});

			let recoveryKey: string | undefined;
			if (includeRecoveryKey) {
				try {
					recoveryKey = await Bun.file(RESTIC_PASS_FILE).text();
					logger.warn("Recovery key exported - this is a security-sensitive operation");
				} catch {
					logger.warn("Could not read recovery key file");
				}
			}

			// Users need special handling for passwordHash (controlled by separate flag)
			const exportUsers = (await exportEntities(users, params)).map((user) => {
				if (!includePasswordHash) {
					delete user.passwordHash;
				}
				return user;
			});

			return c.json({
				version: 1,
				...(params.includeMetadata ? { exportedAt: new Date().toISOString() } : {}),
				...(recoveryKey ? { recoveryKey } : {}),
				volumes: exportVolumes,
				repositories: exportRepositories,
				backupSchedules,
				notificationDestinations: exportNotifications,
				users: exportUsers,
			});
		} catch (err) {
			logger.error(`Config export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: err instanceof Error ? err.message : "Failed to export config" }, 500);
		}
	});
