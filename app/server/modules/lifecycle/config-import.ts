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

async function writeRecoveryKeyFromConfig(recoveryKey: string | null): Promise<void> {
	try {
		const fs = await import("node:fs/promises");
		const { RESTIC_PASS_FILE } = await import("../../core/constants.js");
		if (!recoveryKey) return;

		if (typeof recoveryKey !== "string" || recoveryKey.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(recoveryKey)) {
			throw new Error("Recovery key must be a 64-character hex string");
		}
		const passFileExists = await fs.stat(RESTIC_PASS_FILE).then(
			() => true,
			() => false,
		);
		if (passFileExists) {
			logger.info(`Restic passfile already exists at ${RESTIC_PASS_FILE}; skipping config recovery key write`);
			return;
		}
		await fs.writeFile(RESTIC_PASS_FILE, recoveryKey, { mode: 0o600 });
		logger.info(`Recovery key written from config to ${RESTIC_PASS_FILE}`);
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		logger.error(`Failed to write recovery key from config: ${e.message}`);
	}
}

async function importVolumes(volumes: unknown[]): Promise<void> {
	for (const v of volumes) {
		try {
			if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.config) || typeof v.config.backend !== "string") {
				throw new Error("Invalid volume entry");
			}
			await volumeService.createVolume(v.name, v.config as BackendConfig);
			logger.info(`Initialized volume from config: ${v.name}`);

			// If autoRemount is explicitly false, update the volume (default is true)
			if (v.autoRemount === false) {
				await volumeService.updateVolume(v.name, { autoRemount: false });
				logger.info(`Set autoRemount=false for volume: ${v.name}`);
			}
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Volume not created: ${err.message}`);
		}
	}
}

async function importRepositories(repositories: unknown[]): Promise<void> {
	const repoServiceModule = await import("../repositories/repositories.service");
	for (const r of repositories) {
		try {
			if (!isRecord(r) || typeof r.name !== "string" || !isRecord(r.config) || typeof r.config.backend !== "string") {
				throw new Error("Invalid repository entry");
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
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Repository not created: ${err.message}`);
		}
	}
}

async function importNotificationDestinations(notificationDestinations: unknown[]): Promise<void> {
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

			// If enabled is explicitly false, update the destination (default is true)
			if (n.enabled === false) {
				await notificationsServiceModule.notificationsService.updateDestination(created.id, { enabled: false });
				logger.info(`Set enabled=false for notification destination: ${n.name}`);
			}
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Notification destination not created: ${err.message}`);
		}
	}
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

async function importBackupSchedules(backupSchedules: unknown[]): Promise<void> {
	if (!Array.isArray(backupSchedules) || backupSchedules.length === 0) return;

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
			continue;
		}
		const volume = volumeByName.get(volumeName);
		if (!volume) {
			logger.warn(`Backup schedule not created: Volume '${volumeName}' not found`);
			continue;
		}

		const repositoryName = getScheduleRepositoryName(s);
		if (typeof repositoryName !== "string" || repositoryName.length === 0) {
			logger.warn("Backup schedule not created: Missing repository name");
			continue;
		}
		const repository = repoByName.get(repositoryName);
		if (!repository) {
			logger.warn(`Backup schedule not created: Repository '${repositoryName}' not found`);
			continue;
		}

		const scheduleName = typeof s.name === "string" && s.name.length > 0 ? s.name : `${volumeName}-${repositoryName}`;
		if (typeof s.cronExpression !== "string" || s.cronExpression.length === 0) {
			logger.warn(`Backup schedule not created: Missing cronExpression for '${scheduleName}'`);
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
		} catch (e) {
			const err = e instanceof Error ? e : new Error(String(e));
			logger.warn(`Backup schedule not created: ${err.message}`);
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

async function setupInitialUser(users: unknown[], recoveryKey: string | null): Promise<void> {
	try {
		const { authService } = await import("../auth/auth.service");
		const hasUsers = await authService.hasUsers();
		if (hasUsers) return;
		if (!Array.isArray(users) || users.length === 0) return;

		if (users.length > 1) {
			logger.warn(
				"Multiple users provided in config. Zerobyte currently supports a single initial user; extra entries will be ignored.",
			);
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
					break;
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.warn(`User '${u.username}' not imported: ${err.message}`);
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
					break;
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					logger.warn(`User '${u.username}' not created: ${err.message}`);
				}
				continue;
			}

			logger.warn(`User '${u.username}' missing passwordHash/password; skipping`);
		}
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		logger.error(`Automated user setup failed: ${e.message}`);
	}
}

async function runImport(config: ImportConfig): Promise<void> {
	await writeRecoveryKeyFromConfig(config.recoveryKey);

	await importVolumes(config.volumes);
	await importRepositories(config.repositories);
	await importNotificationDestinations(config.notificationDestinations);
	await importBackupSchedules(config.backupSchedules);
	await setupInitialUser(config.users, config.recoveryKey);
}

/**
 * Import configuration from a raw config object (used by CLI)
 */
export async function applyConfigImport(configRaw: unknown): Promise<void> {
	const config = parseImportConfig(configRaw);
	await runImport(config);
}

/**
 * Import configuration from a file (used by env var startup)
 */
export async function applyConfigImportFromFile(): Promise<void> {
	const configRaw = await loadConfigFromFile();
	const config = parseImportConfig(configRaw);

	try {
		await runImport(config);
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		logger.error(`Failed to initialize from config: ${err.message}`);
	}
}
