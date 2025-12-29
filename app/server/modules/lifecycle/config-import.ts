import { eq } from "drizzle-orm";
import slugify from "slugify";
import { db } from "../../db/db";
import { usersTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { volumeService } from "../volumes/volume.service";
import type { NotificationConfig } from "~/schemas/notifications";
import type { RepositoryConfig } from "~/schemas/restic";
import type { BackendConfig } from "~/schemas/volumes";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const asStringArray = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
};

type RetentionPolicy = {
	keepLast?: number;
	keepHourly?: number;
	keepDaily?: number;
	keepWeekly?: number;
	keepMonthly?: number;
	keepYearly?: number;
	keepWithinDuration?: string;
};

type ImportConfig = {
	volumes: unknown[];
	repositories: unknown[];
	backupSchedules: unknown[];
	notificationDestinations: unknown[];
	users: unknown[];
	recoveryKey: string | null;
};

export type ImportResult = {
	succeeded: number;
	warnings: number;
	errors: number;
};

function interpolateEnvVars(value: unknown): unknown {
	if (typeof value === "string") {
		return value.replace(/\$\{([^}]+)\}/g, (_, v) => {
			if (process.env[v] === undefined) {
				logger.warn(`Environment variable '${v}' is not defined. Replacing with empty string.`);
				return "";
			}
			return process.env[v];
		});
	}
	if (Array.isArray(value)) {
		return value.map(interpolateEnvVars);
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateEnvVars(v)]));
	}
	return value;
}

async function loadConfigFromFile(): Promise<unknown | null> {
	try {
		const configPath = process.env.ZEROBYTE_CONFIG_PATH || "zerobyte.config.json";
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const configFullPath = path.resolve(process.cwd(), configPath);
		try {
			const raw = await fs.readFile(configFullPath, "utf-8");
			return JSON.parse(raw);
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return null;
			throw error;
		}
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		logger.warn(`No config file loaded or error parsing config: ${err.message}`);
		return null;
	}
}

function parseImportConfig(configRaw: unknown): ImportConfig {
	const root = isRecord(configRaw) ? configRaw : {};
	const config = isRecord(root.config) ? (root.config as Record<string, unknown>) : root;

	const volumes = interpolateEnvVars(config.volumes || []);
	const repositories = interpolateEnvVars(config.repositories || []);
	const backupSchedules = interpolateEnvVars(config.backupSchedules || []);
	const notificationDestinations = interpolateEnvVars(config.notificationDestinations || []);
	const users = interpolateEnvVars(config.users || []);
	const recoveryKeyRaw = interpolateEnvVars(config.recoveryKey || null);

	return {
		volumes: Array.isArray(volumes) ? volumes : [],
		repositories: Array.isArray(repositories) ? repositories : [],
		backupSchedules: Array.isArray(backupSchedules) ? backupSchedules : [],
		notificationDestinations: Array.isArray(notificationDestinations) ? notificationDestinations : [],
		users: Array.isArray(users) ? users : [],
		recoveryKey: typeof recoveryKeyRaw === "string" ? recoveryKeyRaw : null,
	};
}

async function writeRecoveryKeyFromConfig(recoveryKey: string | null): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };

	try {
		const fs = await import("node:fs/promises");
		const { RESTIC_PASS_FILE } = await import("../../core/constants.js");
		if (!recoveryKey) return result;

		if (typeof recoveryKey !== "string" || recoveryKey.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(recoveryKey)) {
			throw new Error("Recovery key must be a 64-character hex string");
		}
		const passFileExists = await fs.stat(RESTIC_PASS_FILE).then(
			() => true,
			() => false,
		);
		if (passFileExists) {
			logger.warn(`Restic passfile already exists at ${RESTIC_PASS_FILE}; skipping config recovery key write`);
			result.warnings++;
			return result;
		}
		await fs.writeFile(RESTIC_PASS_FILE, recoveryKey, { mode: 0o600 });
		logger.info(`Recovery key written from config to ${RESTIC_PASS_FILE}`);
		result.succeeded++;
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		logger.error(`Failed to write recovery key from config: ${e.message}`);
		result.errors++;
	}

	return result;
}

async function importVolumes(volumes: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };

	for (const v of volumes) {
		try {
			if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.config) || typeof v.config.backend !== "string") {
				throw new Error("Invalid volume entry");
			}
			await volumeService.createVolume(v.name, v.config as BackendConfig);
			logger.info(`Initialized volume from config: ${v.name}`);
			result.succeeded++;

			// If autoRemount is explicitly false, update the volume (default is true)
			if (v.autoRemount === false) {
				await volumeService.updateVolume(v.name, { autoRemount: false });
				logger.info(`Set autoRemount=false for volume: ${v.name}`);
			}
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Volume not created: ${err.message}`);
			result.warnings++;
		}
	}

	return result;
}

async function importRepositories(repositories: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };
	const repoServiceModule = await import("../repositories/repositories.service");
	const { buildRepoUrl, restic } = await import("../../utils/restic");

	// Get existing repositories and build sets for duplicate detection
	const existingRepos = await repoServiceModule.repositoriesService.listRepositories();
	const existingNames = new Set(existingRepos.map((repo) => repo.name));
	const existingUrls = new Set<string>();

	for (const repo of existingRepos) {
		try {
			// Config fields used for URL (path, bucket, endpoint, etc.) are not encrypted
			const url = buildRepoUrl(repo.config as RepositoryConfig);
			existingUrls.add(url);
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Could not build URL for existing repository '${repo.name}': ${err.message}`);
		}
	}

	for (const r of repositories) {
		try {
			if (!isRecord(r) || typeof r.name !== "string" || !isRecord(r.config) || typeof r.config.backend !== "string") {
				throw new Error("Invalid repository entry");
			}

			// Skip if a repository pointing to the same location is already registered in DB
			try {
				const incomingUrl = buildRepoUrl(r.config as RepositoryConfig);
				if (existingUrls.has(incomingUrl)) {
					logger.warn(`Skipping '${r.name}': another repository is already registered for location ${incomingUrl}`);
					result.warnings++;
					continue;
				}
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Could not build URL for '${r.name}' to check duplicates: ${err.message}`);
			}

			// For local repos without isExistingRepository, check if the provided path is already a restic repo
			// This catches the case where user forgot to set isExistingRepository: true
			if (r.config.backend === "local" && !r.config.isExistingRepository) {
				const isAlreadyRepo = await restic
					.snapshots({ ...r.config, isExistingRepository: true } as RepositoryConfig)
					.then(() => true)
					.catch((e) => {
						const err = e instanceof Error ? e : new Error(String(e));
						logger.debug(`Repo existence check for '${r.name}': ${err.message}`);
						return false;
					});

				if (isAlreadyRepo) {
					logger.warn(
						`Skipping '${r.name}': path '${r.config.path}' is already a restic repository. ` +
							`Set "isExistingRepository": true to import it, or use a different path for a new repository.`,
					);
					result.warnings++;
					continue;
				}
			}

			// Skip if a repository with the same name already exists (fallback for repos without deterministic paths)
			if (existingNames.has(r.name)) {
				logger.warn(`Skipping '${r.name}': a repository with this name already exists`);
				result.warnings++;
				continue;
			}

			const compressionMode =
				r.compressionMode === "auto" || r.compressionMode === "off" || r.compressionMode === "max"
					? r.compressionMode
					: undefined;
			await repoServiceModule.repositoriesService.createRepository(
				r.name,
				r.config as RepositoryConfig,
				compressionMode,
			);
			logger.info(`Initialized repository from config: ${r.name}`);
			result.succeeded++;
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Repository not created: ${err.message}`);
			result.warnings++;
		}
	}

	return result;
}

async function importNotificationDestinations(notificationDestinations: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };
	const notificationsServiceModule = await import("../notifications/notifications.service");
	for (const n of notificationDestinations) {
		try {
			if (!isRecord(n) || typeof n.name !== "string" || !isRecord(n.config) || typeof n.config.type !== "string") {
				throw new Error("Invalid notification destination entry");
			}
			const created = await notificationsServiceModule.notificationsService.createDestination(
				n.name,
				n.config as NotificationConfig,
			);
			logger.info(`Initialized notification destination from config: ${n.name}`);
			result.succeeded++;

			// If enabled is explicitly false, update the destination (default is true)
			if (n.enabled === false) {
				await notificationsServiceModule.notificationsService.updateDestination(created.id, { enabled: false });
				logger.info(`Set enabled=false for notification destination: ${n.name}`);
			}
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Notification destination not created: ${err.message}`);
			result.warnings++;
		}
	}

	return result;
}

function getScheduleVolumeName(schedule: Record<string, unknown>): string | null {
	return typeof schedule.volume === "string"
		? schedule.volume
		: typeof schedule.volumeName === "string"
			? schedule.volumeName
			: null;
}

function getScheduleRepositoryName(schedule: Record<string, unknown>): string | null {
	return typeof schedule.repository === "string"
		? schedule.repository
		: typeof schedule.repositoryName === "string"
			? schedule.repositoryName
			: null;
}

type ScheduleNotificationAssignment = {
	destinationId: number;
	notifyOnStart: boolean;
	notifyOnSuccess: boolean;
	notifyOnWarning: boolean;
	notifyOnFailure: boolean;
};

function buildScheduleNotificationAssignments(
	notifications: unknown[],
	destinationBySlug: Map<string, { id: number; name: string }>,
): ScheduleNotificationAssignment[] {
	const assignments: ScheduleNotificationAssignment[] = [];

	for (const notif of notifications) {
		const destName = typeof notif === "string" ? notif : isRecord(notif) ? notif.name : null;
		if (typeof destName !== "string" || destName.length === 0) {
			logger.warn("Notification destination missing name for schedule");
			continue;
		}
		const destSlug = slugify(destName, { lower: true, strict: true });
		const dest = destinationBySlug.get(destSlug);
		if (!dest) {
			logger.warn(`Notification destination '${destName}' not found for schedule`);
			continue;
		}
		assignments.push({
			destinationId: dest.id,
			notifyOnStart: isRecord(notif) && typeof notif.notifyOnStart === "boolean" ? notif.notifyOnStart : true,
			notifyOnSuccess: isRecord(notif) && typeof notif.notifyOnSuccess === "boolean" ? notif.notifyOnSuccess : true,
			notifyOnWarning: isRecord(notif) && typeof notif.notifyOnWarning === "boolean" ? notif.notifyOnWarning : true,
			notifyOnFailure: isRecord(notif) && typeof notif.notifyOnFailure === "boolean" ? notif.notifyOnFailure : true,
		});
	}

	return assignments;
}

async function attachScheduleNotifications(
	scheduleId: number,
	notifications: unknown[],
	destinationBySlug: Map<string, { id: number; name: string }>,
	notificationsServiceModule: typeof import("../notifications/notifications.service"),
): Promise<void> {
	try {
		const assignments = buildScheduleNotificationAssignments(notifications, destinationBySlug);
		if (assignments.length === 0) return;

		await notificationsServiceModule.notificationsService.updateScheduleNotifications(scheduleId, assignments);
		logger.info(`Assigned ${assignments.length} notification(s) to backup schedule`);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		logger.warn(`Failed to assign notifications to schedule: ${err.message}`);
	}
}

async function importBackupSchedules(backupSchedules: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };
	if (!Array.isArray(backupSchedules) || backupSchedules.length === 0) return result;

	const backupServiceModule = await import("../backups/backups.service");
	const notificationsServiceModule = await import("../notifications/notifications.service");

	const volumes = await db.query.volumesTable.findMany();
	const repositories = await db.query.repositoriesTable.findMany();
	const destinations = await db.query.notificationDestinationsTable.findMany();

	const volumeByName = new Map(volumes.map((v) => [v.name, v] as const));
	const repoByName = new Map(repositories.map((r) => [r.name, r] as const));
	const destinationBySlug = new Map(destinations.map((d) => [d.name, d] as const));

	for (const s of backupSchedules) {
		if (!isRecord(s)) {
			continue;
		}
		const volumeName = getScheduleVolumeName(s);
		if (typeof volumeName !== "string" || volumeName.length === 0) {
			logger.warn("Backup schedule not created: Missing volume name");
			result.warnings++;
			continue;
		}
		const volume = volumeByName.get(volumeName);
		if (!volume) {
			logger.warn(`Backup schedule not created: Volume '${volumeName}' not found`);
			result.warnings++;
			continue;
		}

		const repositoryName = getScheduleRepositoryName(s);
		if (typeof repositoryName !== "string" || repositoryName.length === 0) {
			logger.warn("Backup schedule not created: Missing repository name");
			result.warnings++;
			continue;
		}
		const repository = repoByName.get(repositoryName);
		if (!repository) {
			logger.warn(`Backup schedule not created: Repository '${repositoryName}' not found`);
			result.warnings++;
			continue;
		}

		const scheduleName = typeof s.name === "string" && s.name.length > 0 ? s.name : `${volumeName}-${repositoryName}`;
		if (typeof s.cronExpression !== "string" || s.cronExpression.length === 0) {
			logger.warn(`Backup schedule not created: Missing cronExpression for '${scheduleName}'`);
			result.warnings++;
			continue;
		}

		if (volume.status !== "mounted") {
			try {
				await volumeService.mountVolume(volume.name);
				volumeByName.set(volume.name, { ...volume, status: "mounted" });
				logger.info(`Mounted volume ${volume.name} for backup schedule`);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Could not mount volume ${volume.name}: ${err.message}`);
				result.warnings++;
				continue;
			}
		}

		let createdSchedule: { id: number } | null = null;
		try {
			const retentionPolicy = isRecord(s.retentionPolicy) ? (s.retentionPolicy as RetentionPolicy) : undefined;
			createdSchedule = await backupServiceModule.backupsService.createSchedule({
				name: scheduleName,
				volumeId: volume.id,
				repositoryId: repository.id,
				enabled: typeof s.enabled === "boolean" ? s.enabled : true,
				cronExpression: s.cronExpression,
				retentionPolicy,
				excludePatterns: asStringArray(s.excludePatterns),
				excludeIfPresent: asStringArray(s.excludeIfPresent),
				includePatterns: asStringArray(s.includePatterns),
				oneFileSystem: typeof s.oneFileSystem === "boolean" ? s.oneFileSystem : undefined,
			});
			logger.info(`Initialized backup schedule from config: ${scheduleName}`);
			result.succeeded++;
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Backup schedule not created: ${err.message}`);
			result.warnings++;
			continue;
		}

		if (createdSchedule && Array.isArray(s.notifications) && s.notifications.length > 0) {
			await attachScheduleNotifications(
				createdSchedule.id,
				s.notifications,
				destinationBySlug,
				notificationsServiceModule,
			);
		}

		if (createdSchedule && Array.isArray(s.mirrors) && s.mirrors.length > 0) {
			await attachScheduleMirrors(createdSchedule.id, s.mirrors, repoByName, backupServiceModule);
		}
	}

	return result;
}

async function attachScheduleMirrors(
	scheduleId: number,
	mirrors: unknown[],
	repoByName: Map<string, { id: string; name: string }>,
	backupServiceModule: typeof import("../backups/backups.service"),
): Promise<void> {
	try {
		const mirrorConfigs: Array<{ repositoryId: string; enabled: boolean }> = [];

		for (const m of mirrors) {
			if (!isRecord(m)) continue;

			// Support both repository name (string) and repository object with name
			const repoName =
				typeof m.repository === "string"
					? m.repository
					: typeof m.repositoryName === "string"
						? m.repositoryName
						: null;

			if (!repoName) {
				logger.warn("Mirror missing repository name; skipping");
				continue;
			}

			const repo = repoByName.get(repoName);
			if (!repo) {
				logger.warn(`Mirror repository '${repoName}' not found; skipping`);
				continue;
			}

			mirrorConfigs.push({
				repositoryId: repo.id,
				enabled: typeof m.enabled === "boolean" ? m.enabled : true,
			});
		}

		if (mirrorConfigs.length === 0) return;

		await backupServiceModule.backupsService.updateMirrors(scheduleId, { mirrors: mirrorConfigs });
		logger.info(`Assigned ${mirrorConfigs.length} mirror(s) to backup schedule`);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		logger.warn(`Failed to assign mirrors to schedule: ${err.message}`);
	}
}

async function setupInitialUser(users: unknown[], recoveryKey: string | null): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };

	try {
		const { authService } = await import("../auth/auth.service");
		const hasUsers = await authService.hasUsers();
		if (hasUsers) return result;
		if (!Array.isArray(users) || users.length === 0) return result;

		if (users.length > 1) {
			logger.warn(
				"Multiple users provided in config. Zerobyte currently supports a single initial user; extra entries will be ignored.",
			);
			result.warnings++;
		}

		for (const u of users) {
			if (!isRecord(u)) continue;
			if (typeof u.username !== "string" || u.username.length === 0) continue;

			if (typeof u.passwordHash === "string" && u.passwordHash.length > 0) {
				try {
					await db.insert(usersTable).values({
						username: u.username,
						passwordHash: u.passwordHash,
						hasDownloadedResticPassword:
							typeof u.hasDownloadedResticPassword === "boolean" ? u.hasDownloadedResticPassword : Boolean(recoveryKey),
					});
					logger.info(`User '${u.username}' imported with password hash from config.`);
					result.succeeded++;
					break;
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.warn(`User '${u.username}' not imported: ${err.message}`);
					result.warnings++;
				}
				continue;
			}

			if (typeof u.password === "string" && u.password.length > 0) {
				try {
					const { user } = await authService.register(u.username, u.password);
					const hasDownloadedResticPassword =
						typeof u.hasDownloadedResticPassword === "boolean" ? u.hasDownloadedResticPassword : Boolean(recoveryKey);
					if (hasDownloadedResticPassword) {
						await db.update(usersTable).set({ hasDownloadedResticPassword }).where(eq(usersTable.id, user.id));
					}
					logger.info(`User '${u.username}' created from config.`);
					result.succeeded++;
					break;
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.warn(`User '${u.username}' not created: ${err.message}`);
					result.warnings++;
				}
				continue;
			}

			logger.warn(`User '${u.username}' missing passwordHash/password; skipping`);
			result.warnings++;
		}
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		logger.error(`Automated user setup failed: ${e.message}`);
		result.errors++;
	}

	return result;
}

async function runImport(config: ImportConfig): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, warnings: 0, errors: 0 };

	const recoveryKeyResult = await writeRecoveryKeyFromConfig(config.recoveryKey);
	const volumeResult = await importVolumes(config.volumes);
	const repoResult = await importRepositories(config.repositories);
	const notifResult = await importNotificationDestinations(config.notificationDestinations);
	const scheduleResult = await importBackupSchedules(config.backupSchedules);
	const userResult = await setupInitialUser(config.users, config.recoveryKey);

	for (const r of [recoveryKeyResult, volumeResult, repoResult, notifResult, scheduleResult, userResult]) {
		result.succeeded += r.succeeded;
		result.warnings += r.warnings;
		result.errors += r.errors;
	}

	return result;
}

function logImportSummary(result: ImportResult): void {
	if (result.errors > 0) {
		logger.error(
			`Config import completed with ${result.errors} error(s) and ${result.warnings} warning(s), ${result.succeeded} item(s) imported`,
		);
	} else if (result.warnings > 0) {
		logger.warn(`Config import completed with ${result.warnings} warning(s), ${result.succeeded} item(s) imported`);
	} else if (result.succeeded > 0) {
		logger.info(`Config import completed successfully: ${result.succeeded} item(s) imported`);
	} else {
		logger.info("Config import completed: no items to import");
	}
}

/**
 * Import configuration from a raw config object (used by CLI)
 */
export async function applyConfigImport(configRaw: unknown): Promise<ImportResult> {
	logger.info("Starting config import...");
	const config = parseImportConfig(configRaw);
	const result = await runImport(config);
	logImportSummary(result);
	return result;
}

/**
 * Import configuration from a file (used by env var startup)
 */
export async function applyConfigImportFromFile(): Promise<void> {
	const configRaw = await loadConfigFromFile();
	if (configRaw === null) return; // No config file, nothing to do

	logger.info("Starting config import from file...");
	const config = parseImportConfig(configRaw);

	try {
		const result = await runImport(config);
		logImportSummary(result);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		logger.error(`Config import failed: ${err.message}`);
	}
}
