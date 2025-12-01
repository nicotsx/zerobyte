import { Hono } from "hono";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import {
	backupSchedulesTable,
	notificationDestinationsTable,
	repositoriesTable,
	backupScheduleNotificationsTable,
	usersTable,
	volumesTable,
} from "../../db/schema";
import { db } from "../../db/db";
import { logger } from "../../utils/logger";
import { RESTIC_PASS_FILE } from "../../core/constants";
import { cryptoUtils } from "../../utils/crypto";

// ============================================================================
// Types
// ============================================================================

type SecretsMode = "exclude" | "encrypted" | "cleartext";

type ExportParams = {
	includeIds: boolean;
	includeTimestamps: boolean;
	secretsMode: SecretsMode;
	excludeKeys: string[];
};

type FilterOptions = { id?: string; name?: string };

type FetchResult<T> = { data: T[] } | { error: string; status: 400 | 404 };

// ============================================================================
// Helper Functions
// ============================================================================

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
	return [
		...(includeRuntimeState ? [] : runtimeStateKeys),
		...(includeIds ? [] : idKeys),
		...(includeTimestamps ? [] : timestampKeys),
	];
}

/** Parse common export query parameters from request */
function parseExportParams(c: Context): ExportParams {
	const includeIds = c.req.query("includeIds") !== "false";
	const includeTimestamps = c.req.query("includeTimestamps") !== "false";
	const includeRuntimeState = c.req.query("includeRuntimeState") === "true";
	const secretsMode = (c.req.query("secretsMode") as SecretsMode) || "exclude";
	const excludeKeys = getExcludeKeys(includeIds, includeTimestamps, includeRuntimeState);
	return { includeIds, includeTimestamps, secretsMode, excludeKeys };
}

/** Get filter options from request query params */
function getFilterOptions(c: Context): FilterOptions {
	return { id: c.req.query("id"), name: c.req.query("name") };
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
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
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

// ============================================================================
// Data Fetchers with Filtering
// ============================================================================

async function fetchVolumes(filter: FilterOptions): Promise<FetchResult<typeof volumesTable.$inferSelect>> {
	if (filter.id) {
		const id = Number.parseInt(filter.id, 10);
		if (Number.isNaN(id)) return { error: "Invalid volume ID", status: 400 };
		const result = await db.select().from(volumesTable).where(eq(volumesTable.id, id));
		if (result.length === 0) return { error: `Volume with ID '${filter.id}' not found`, status: 404 };
		return { data: result };
	}
	if (filter.name) {
		const result = await db.select().from(volumesTable).where(eq(volumesTable.name, filter.name));
		if (result.length === 0) return { error: `Volume '${filter.name}' not found`, status: 404 };
		return { data: result };
	}
	return { data: await db.select().from(volumesTable) };
}

async function fetchRepositories(filter: FilterOptions): Promise<FetchResult<typeof repositoriesTable.$inferSelect>> {
	if (filter.id) {
		// Validate UUID format
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		if (!uuidRegex.test(filter.id)) {
			return { error: "Invalid repository ID format (expected UUID)", status: 400 };
		}
		const result = await db.select().from(repositoriesTable).where(eq(repositoriesTable.id, filter.id));
		if (result.length === 0) return { error: `Repository with ID '${filter.id}' not found`, status: 404 };
		return { data: result };
	}
	if (filter.name) {
		const result = await db.select().from(repositoriesTable).where(eq(repositoriesTable.name, filter.name));
		if (result.length === 0) return { error: `Repository '${filter.name}' not found`, status: 404 };
		return { data: result };
	}
	return { data: await db.select().from(repositoriesTable) };
}

async function fetchNotifications(filter: FilterOptions): Promise<FetchResult<typeof notificationDestinationsTable.$inferSelect>> {
	if (filter.id) {
		const id = Number.parseInt(filter.id, 10);
		if (Number.isNaN(id)) return { error: "Invalid notification destination ID", status: 400 };
		const result = await db.select().from(notificationDestinationsTable).where(eq(notificationDestinationsTable.id, id));
		if (result.length === 0) return { error: `Notification destination with ID '${filter.id}' not found`, status: 404 };
		return { data: result };
	}
	if (filter.name) {
		const result = await db.select().from(notificationDestinationsTable).where(eq(notificationDestinationsTable.name, filter.name));
		if (result.length === 0) return { error: `Notification destination '${filter.name}' not found`, status: 404 };
		return { data: result };
	}
	return { data: await db.select().from(notificationDestinationsTable) };
}

async function fetchBackupSchedules(filter: { id?: string }): Promise<FetchResult<typeof backupSchedulesTable.$inferSelect>> {
	if (filter.id) {
		const id = Number.parseInt(filter.id, 10);
		if (Number.isNaN(id)) return { error: "Invalid backup schedule ID", status: 400 };
		const result = await db.select().from(backupSchedulesTable).where(eq(backupSchedulesTable.id, id));
		if (result.length === 0) return { error: `Backup schedule with ID '${filter.id}' not found`, status: 404 };
		return { data: result };
	}
	return { data: await db.select().from(backupSchedulesTable) };
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

// ============================================================================
// Controller
// ============================================================================

/**
 * Config Export API
 * 
 * Query parameters:
 * - includeIds: "true" | "false" (default: "true") - Include database IDs
 * - includeTimestamps: "true" | "false" (default: "true") - Include createdAt/updatedAt
 * - includeRecoveryKey: "true" | "false" (default: "false") - Include recovery key (full export only)
 * - includePasswordHash: "true" | "false" (default: "false") - Include admin password hash (full export only)
 * - secretsMode: "exclude" | "encrypted" | "cleartext" (default: "exclude") - How to handle secrets
 * - id: string (optional) - Filter by ID
 * - name: string (optional) - Filter by name (not for backups)
 */
export const configExportController = new Hono()
	.get("/export", async (c) => {
		try {
			const params = parseExportParams(c);
			const includeRecoveryKey = c.req.query("includeRecoveryKey") === "true";
			const includePasswordHash = c.req.query("includePasswordHash") === "true";

			const [volumes, repositories, backupSchedulesRaw, notifications, scheduleNotifications, [admin]] = await Promise.all([
				db.select().from(volumesTable),
				db.select().from(repositoriesTable),
				db.select().from(backupSchedulesTable),
				db.select().from(notificationDestinationsTable),
				db.select().from(backupScheduleNotificationsTable),
				db.select().from(usersTable).limit(1),
			]);

			const volumeMap = new Map<number, string>(volumes.map((v) => [v.id, v.name]));
			const repoMap = new Map<string, string>(repositories.map((r) => [r.id, r.name]));
			const notificationMap = new Map<number, string>(notifications.map((n) => [n.id, n.name]));

			const backupSchedules = transformBackupSchedules(
				backupSchedulesRaw, scheduleNotifications, volumeMap, repoMap, notificationMap, params
			);

			// TODO: Volumes will have encrypted secrets (e.g., SMB/NFS credentials) in a future PR
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
	.get("/export/volumes", async (c) => {
		try {
			const params = parseExportParams(c);
			const result = await fetchVolumes(getFilterOptions(c));
			if ("error" in result) return c.json({ error: result.error }, result.status);
			// TODO: Volumes will have encrypted secrets (e.g., SMB/NFS credentials) in a future PR
			return c.json({ volumes: await exportEntities(result.data, params) });
		} catch (err) {
			logger.error(`Volumes export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export volumes: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	})
	.get("/export/repositories", async (c) => {
		try {
			const params = parseExportParams(c);
			const result = await fetchRepositories(getFilterOptions(c));
			if ("error" in result) return c.json({ error: result.error }, result.status);
			return c.json({ repositories: await exportEntities(result.data, params) });
		} catch (err) {
			logger.error(`Repositories export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: `Failed to export repositories: ${err instanceof Error ? err.message : String(err)}` }, 500);
		}
	})
	.get("/export/notification-destinations", async (c) => {
		try {
			const params = parseExportParams(c);
			const result = await fetchNotifications(getFilterOptions(c));
			if ("error" in result) return c.json({ error: result.error }, result.status);
			return c.json({ notificationDestinations: await exportEntities(result.data, params) });
		} catch (err) {
			logger.error(`Notification destinations export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: "Failed to export notification destinations" }, 500);
		}
	})
	.get("/export/backup-schedules", async (c) => {
		try {
			const params = parseExportParams(c);

			const [volumes, repositories, notifications, scheduleNotifications] = await Promise.all([
				db.select().from(volumesTable),
				db.select().from(repositoriesTable),
				db.select().from(notificationDestinationsTable),
				db.select().from(backupScheduleNotificationsTable),
			]);

			const result = await fetchBackupSchedules({ id: c.req.query("id") });
			if ("error" in result) return c.json({ error: result.error }, result.status);

			const volumeMap = new Map<number, string>(volumes.map((v) => [v.id, v.name]));
			const repoMap = new Map<string, string>(repositories.map((r) => [r.id, r.name]));
			const notificationMap = new Map<number, string>(notifications.map((n) => [n.id, n.name]));

			const backupSchedules = transformBackupSchedules(
				result.data, scheduleNotifications, volumeMap, repoMap, notificationMap, params
			);

			return c.json({ backupSchedules });
		} catch (err) {
			logger.error(`Backup schedules export failed: ${err instanceof Error ? err.message : String(err)}`);
			return c.json({ error: "Failed to export backup schedules" }, 500);
		}
	});


