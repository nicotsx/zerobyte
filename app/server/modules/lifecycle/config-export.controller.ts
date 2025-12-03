import { validator } from "hono-openapi";

import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import {
	backupSchedulesTable,
	backupScheduleNotificationsTable,
	usersTable,
} from "../../db/schema";
import { db } from "../../db/db";
import { logger } from "../../utils/logger";
import { RESTIC_PASS_FILE } from "../../core/constants";
import { cryptoUtils } from "../../utils/crypto";
import { authService } from "../auth/auth.service";
import { volumeService } from "../volumes/volume.service";
import { repositoriesService } from "../repositories/repositories.service";
import { notificationsService } from "../notifications/notifications.service";
import { backupsService } from "../backups/backups.service";
import {
	fullExportBodySchema,
	entityExportBodySchema,
	backupScheduleExportBodySchema,
	fullExportDto,
	volumesExportDto,
	repositoriesExportDto,
	notificationsExportDto,
	backupSchedulesExportDto,
	type SecretsMode,
	type FullExportBody,
	type EntityExportBody,
	type BackupScheduleExportBody,
} from "./config-export.dto";

const COOKIE_NAME = "session_id";
const COOKIE_OPTIONS = {
	httpOnly: true,
	secure: false,
	sameSite: "lax" as const,
	path: "/",
};

type ExportParams = {
	includeIds: boolean;
	includeTimestamps: boolean;
	secretsMode: SecretsMode;
	excludeKeys: string[];
};

function omitKeys<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
	const result = { ...obj };
	for (const key of keys) {
		delete result[key as keyof T];
	}
	return result;
}

function getExcludeKeys(includeIds: boolean, includeTimestamps: boolean, includeRuntimeState: boolean): string[] {
	const idKeys = ["id", "volumeId", "repositoryId", "scheduleId", "destinationId"];
	const timestampKeys = ["createdAt", "updatedAt"];
	// Runtime state fields (status, health checks, last backup info, etc.)
	const runtimeStateKeys = [
		// Volume state
		"status", "lastError", "lastHealthCheck",
		// Repository state
		"lastChecked",
		// Backup schedule state
		"lastBackupAt", "lastBackupStatus", "lastBackupError", "nextBackupAt",
	];
	// Redundant fields that are already present inside the config object
	// (e.g., type is duplicated as config.backend or config.type)
	const redundantKeys = ["type"];
	return [
		...redundantKeys,
		...(includeRuntimeState ? [] : runtimeStateKeys),
		...(includeIds ? [] : idKeys),
		...(includeTimestamps ? [] : timestampKeys),
	];
}

/** Parse export params from request body */
function parseExportParamsFromBody(body: {
	includeIds?: boolean;
	includeTimestamps?: boolean;
	includeRuntimeState?: boolean;
	secretsMode?: SecretsMode;
}): ExportParams {
	const includeIds = body.includeIds !== false;
	const includeTimestamps = body.includeTimestamps !== false;
	const includeRuntimeState = body.includeRuntimeState === true;
	const secretsMode: SecretsMode = body.secretsMode ?? "exclude";
	const excludeKeys = getExcludeKeys(includeIds, includeTimestamps, includeRuntimeState);
	return { includeIds, includeTimestamps, secretsMode, excludeKeys };
}

/**
 * Verify password for export operation.
 * All exports require password verification for security.
 */
async function verifyExportPassword(
	c: Context,
	password: string
): Promise<{ valid: true; userId: number } | { valid: false; error: string }> {
	const sessionId = getCookie(c, COOKIE_NAME);
	if (!sessionId) {
		return { valid: false, error: "Not authenticated" };
	}

	const session = await authService.verifySession(sessionId);
	if (!session) {
		deleteCookie(c, COOKIE_NAME, COOKIE_OPTIONS);
		return { valid: false, error: "Session expired" };
	}

	const isValid = await authService.verifyPassword(session.user.id, password);
	if (!isValid) {
		return { valid: false, error: "Incorrect password" };
	}

	return { valid: true, userId: session.user.id };
}

/**
 * Process secrets in an object based on the secrets mode.
 * Automatically detects encrypted fields using cryptoUtils.isEncrypted.
 */
async function processSecrets(
	obj: Record<string, unknown>,
	secretsMode: SecretsMode
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
						: item
				)
			);
		} else if (value && typeof value === "object") {
			result[key] = await processSecrets(value as Record<string, unknown>, secretsMode);
		}
	}

	return result;
}

/** Clean and process an entity for export */
async function exportEntity(
	entity: Record<string, unknown>,
	params: ExportParams
): Promise<Record<string, unknown>> {
	const cleaned = omitKeys(entity, params.excludeKeys);
	return processSecrets(cleaned, params.secretsMode);
}

/** Export multiple entities */
async function exportEntities<T extends Record<string, unknown>>(
	entities: T[],
	params: ExportParams
): Promise<Record<string, unknown>[]> {
	return Promise.all(entities.map((e) => exportEntity(e as Record<string, unknown>, params)));
}

/** Transform backup schedules with resolved names and notifications */
function transformBackupSchedules(
	schedules: typeof backupSchedulesTable.$inferSelect[],
	scheduleNotifications: typeof backupScheduleNotificationsTable.$inferSelect[],
	volumeMap: Map<number, string>,
	repoMap: Map<string, string>,
	notificationMap: Map<number, string>,
	params: ExportParams
) {
	return schedules.map((schedule) => {
		const assignments = scheduleNotifications
			.filter((sn) => sn.scheduleId === schedule.id)
			.map((sn) => ({
				...(params.includeIds ? { destinationId: sn.destinationId } : {}),
				name: notificationMap.get(sn.destinationId) ?? null,
				notifyOnStart: sn.notifyOnStart,
				notifyOnSuccess: sn.notifyOnSuccess,
				notifyOnFailure: sn.notifyOnFailure,
			}));

		return {
			...omitKeys(schedule as Record<string, unknown>, params.excludeKeys),
			volume: volumeMap.get(schedule.volumeId) ?? null,
			repository: repoMap.get(schedule.repositoryId) ?? null,
			notifications: assignments,
		};
	});
}

export const configExportController = new Hono()
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
			const [volumes, repositories, backupSchedulesRaw, notifications, scheduleNotifications, [admin]] = await Promise.all([
				volumeService.listVolumes(),
				repositoriesService.listRepositories(),
				backupsService.listSchedules(),
				notificationsService.listDestinations(),
				db.select().from(backupScheduleNotificationsTable),
				db.select().from(usersTable).limit(1),
			]);

			const volumeMap = new Map<number, string>(volumes.map((v) => [v.id, v.name]));
			const repoMap = new Map<string, string>(repositories.map((r) => [r.id, r.name]));
			const notificationMap = new Map<number, string>(notifications.map((n) => [n.id, n.name]));

			const backupSchedules = transformBackupSchedules(
				backupSchedulesRaw, scheduleNotifications, volumeMap, repoMap, notificationMap, params
			);

			const [exportVolumes, exportRepositories, exportNotifications] = await Promise.all([
				exportEntities(volumes, params),
				exportEntities(repositories, params),
				exportEntities(notifications, params),
			]);

			let recoveryKey: string | undefined;
			if (includeRecoveryKey) {
				try {
					recoveryKey = await Bun.file(RESTIC_PASS_FILE).text();
					logger.warn("Recovery key exported - this is a security-sensitive operation");
				} catch {
					logger.warn("Could not read recovery key file");
				}
			}

			return c.json({
				version: 1,
				exportedAt: new Date().toISOString(),
				volumes: exportVolumes,
				repositories: exportRepositories,
				backupSchedules,
				notificationDestinations: exportNotifications,
				admin: admin ? {
					username: admin.username,
					...(includePasswordHash ? { passwordHash: admin.passwordHash } : {}),
					...(recoveryKey ? { recoveryKey } : {}),
				} : null,
			});
		} catch (err) {
			logger.error(`Config export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: err instanceof Error ? err.message : "Failed to export config" }, 500);
		}
	})
	.post("/export/volumes", volumesExportDto, validator("json", entityExportBodySchema), async (c) => {
		try {
			const body = c.req.valid("json") as EntityExportBody;

			// Verify password - required for all exports
			const verification = await verifyExportPassword(c, body.password);
			if (!verification.valid) {
				return c.json({ error: verification.error }, 401);
			}

			const params = parseExportParamsFromBody(body);

			let volumes;
			// Prefer name over id since volumeService.getVolume expects name (slug)
			if (body.name) {
				try {
					const result = await volumeService.getVolume(body.name);
					volumes = [result.volume];
				} catch {
					return c.json({ error: `Volume '${body.name}' not found` }, 404);
				}
			} else if (body.id !== undefined) {
				// If only ID provided, find volume by numeric ID from list
				const id = typeof body.id === "string" ? Number.parseInt(body.id, 10) : body.id;
				if (Number.isNaN(id)) {
					return c.json({ error: "Invalid volume ID" }, 400);
				}
				const allVolumes = await volumeService.listVolumes();
				const volume = allVolumes.find((v) => v.id === id);
				if (!volume) {
					return c.json({ error: `Volume with ID '${body.id}' not found` }, 404);
				}
				volumes = [volume];
			} else {
				volumes = await volumeService.listVolumes();
			}

			return c.json({ volumes: await exportEntities(volumes, params) });
		} catch (err) {
			logger.error(`Volumes export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export volumes: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	})
	.post("/export/repositories", repositoriesExportDto, validator("json", entityExportBodySchema), async (c) => {
		try {
			const body = c.req.valid("json") as EntityExportBody;

			// Verify password - required for all exports
			const verification = await verifyExportPassword(c, body.password);
			if (!verification.valid) {
				return c.json({ error: verification.error }, 401);
			}

			const params = parseExportParamsFromBody(body);

			let repositories;
			// Prefer name over id since repositoriesService.getRepository expects name (slug)
			if (body.name) {
				try {
					const result = await repositoriesService.getRepository(body.name);
					repositories = [result.repository];
				} catch {
					return c.json({ error: `Repository '${body.name}' not found` }, 404);
				}
			} else if (body.id !== undefined) {
				// If only ID provided, find repository by ID from list
				// Repository IDs are strings (UUIDs), not numeric
				const allRepositories = await repositoriesService.listRepositories();
				const repository = allRepositories.find((r) => r.id === String(body.id));
				if (!repository) {
					return c.json({ error: `Repository with ID '${body.id}' not found` }, 404);
				}
				repositories = [repository];
			} else {
				repositories = await repositoriesService.listRepositories();
			}

			return c.json({ repositories: await exportEntities(repositories, params) });
		} catch (err) {
			logger.error(`Repositories export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export repositories: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	})
	.post("/export/notification-destinations", notificationsExportDto, validator("json", entityExportBodySchema), async (c) => {
		try {
			const body = c.req.valid("json") as EntityExportBody;

			// Verify password - required for all exports
			const verification = await verifyExportPassword(c, body.password);
			if (!verification.valid) {
				return c.json({ error: verification.error }, 401);
			}

			const params = parseExportParamsFromBody(body);

			let notifications;
			if (body.id !== undefined) {
				const id = typeof body.id === "string" ? Number.parseInt(body.id, 10) : body.id;
				if (Number.isNaN(id)) {
					return c.json({ error: "Invalid notification destination ID" }, 400);
				}
				try {
					const destination = await notificationsService.getDestination(id);
					notifications = [destination];
				} catch {
					return c.json({ error: `Notification destination with ID '${body.id}' not found` }, 404);
				}
			} else if (body.name) {
				// notificationsService doesn't have getByName, so we list and filter
				const allDestinations = await notificationsService.listDestinations();
				const destination = allDestinations.find((d) => d.name === body.name);
				if (!destination) {
					return c.json({ error: `Notification destination '${body.name}' not found` }, 404);
				}
				notifications = [destination];
			} else {
				notifications = await notificationsService.listDestinations();
			}

			return c.json({ notificationDestinations: await exportEntities(notifications, params) });
		} catch (err) {
			logger.error(`Notification destinations export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export notification destinations: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	})
	.post("/export/backup-schedules", backupSchedulesExportDto, validator("json", backupScheduleExportBodySchema), async (c) => {
		try {
			const body = c.req.valid("json") as BackupScheduleExportBody;

			// Verify password - required for all exports
			const verification = await verifyExportPassword(c, body.password);
			if (!verification.valid) {
				return c.json({ error: verification.error }, 401);
			}

			const params = parseExportParamsFromBody(body);

			// Get all related data for name resolution
			const [volumes, repositories, notifications, scheduleNotifications] = await Promise.all([
				volumeService.listVolumes(),
				repositoriesService.listRepositories(),
				notificationsService.listDestinations(),
				db.select().from(backupScheduleNotificationsTable),
			]);

			let schedules;
			if (body.id !== undefined) {
				try {
					const schedule = await backupsService.getSchedule(body.id);
					schedules = [schedule];
				} catch {
					return c.json({ error: `Backup schedule with ID '${body.id}' not found` }, 404);
				}
			} else {
				schedules = await backupsService.listSchedules();
			}

			const volumeMap = new Map<number, string>(volumes.map((v) => [v.id, v.name]));
			const repoMap = new Map<string, string>(repositories.map((r) => [r.id, r.name]));
			const notificationMap = new Map<number, string>(notifications.map((n) => [n.id, n.name]));

			const backupSchedules = transformBackupSchedules(
				schedules, scheduleNotifications, volumeMap, repoMap, notificationMap, params
			);

			return c.json({ backupSchedules });
		} catch (err) {
			logger.error(`Backup schedules export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export backup schedules: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	});


