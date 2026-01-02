import { eq } from "drizzle-orm";
import fs from "node:fs/promises";
import path from "node:path";
import slugify from "slugify";
import { db } from "../../db/db";
import { usersTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { volumeService } from "../volumes/volume.service";
import type { NotificationConfig } from "~/schemas/notifications";
import type { RepositoryConfig } from "~/schemas/restic";
import type { BackendConfig } from "~/schemas/volumes";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

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
	skipped: number;
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
		const configFullPath = path.resolve(process.cwd(), configPath);
		try {
			const raw = await fs.readFile(configFullPath, "utf-8");
			return JSON.parse(raw);
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") return null;
			throw error;
		}
	} catch (error) {
		logger.warn(`No config file loaded or error parsing config: ${toError(error).message}`);
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

function mergeResults(target: ImportResult, source: ImportResult): void {
	target.succeeded += source.succeeded;
	target.skipped += source.skipped;
	target.warnings += source.warnings;
	target.errors += source.errors;
}

async function writeRecoveryKeyFromConfig(recoveryKey: string | null): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };

	try {
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
			// Check if existing key matches the one being imported
			const existingKey = await fs.readFile(RESTIC_PASS_FILE, "utf-8");
			if (existingKey.trim() === recoveryKey) {
				logger.info("Recovery key already configured with matching value");
				result.skipped++;
			} else {
				logger.error("Recovery key already exists with different value; cannot overwrite");
				result.errors++;
			}
			return result;
		}
		await fs.writeFile(RESTIC_PASS_FILE, recoveryKey, { mode: 0o600 });
		logger.info(`Recovery key written from config to ${RESTIC_PASS_FILE}`);
		result.succeeded++;
	} catch (err) {
		logger.error(`Failed to write recovery key from config: ${toError(err).message}`);
		result.errors++;
	}

	return result;
}

async function importVolumes(volumes: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };

	// Get existing volumes to check for duplicates
	const existingVolumes = await volumeService.listVolumes();
	const existingNames = new Set(existingVolumes.map((v) => v.name));

	for (const v of volumes) {
		try {
			if (!isRecord(v) || typeof v.name !== "string" || !isRecord(v.config) || typeof v.config.backend !== "string") {
				throw new Error("Invalid volume entry");
			}

			// The service uses slugify to normalize the name, so we check against stored names
			const slugifiedName = slugify(v.name, { lower: true, strict: true });
			if (existingNames.has(slugifiedName)) {
				logger.info(`Volume '${v.name}' already exists`);
				result.skipped++;
				continue;
			}

			// Pass shortId from config if provided (for IaC reproducibility)
			const shortId = typeof v.shortId === "string" ? v.shortId : undefined;
			await volumeService.createVolume(v.name, v.config as BackendConfig, shortId);
			logger.info(`Initialized volume from config: ${v.name}`);
			result.succeeded++;

			// If autoRemount is explicitly false, update the volume (default is true)
			if (v.autoRemount === false) {
				await volumeService.updateVolume(v.name, { autoRemount: false });
				logger.info(`Set autoRemount=false for volume: ${v.name}`);
			}
		} catch (e) {
			const volumeName = isRecord(v) && typeof v.name === "string" ? v.name : "unknown";
			logger.warn(`Volume '${volumeName}' not created: ${toError(e).message}`);
			result.warnings++;
		}
	}

	return result;
}

async function importRepositories(repositories: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };
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
			logger.warn(`Could not build URL for existing repository '${repo.name}': ${toError(e).message}`);
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
					logger.info(`Repository '${r.name}': another repository already registered for location ${incomingUrl}`);
					result.skipped++;
					continue;
				}
			} catch (e) {
				logger.warn(`Could not build URL for '${r.name}' to check duplicates: ${toError(e).message}`);
			}

			// For repos without isExistingRepository, check if the location is already a restic repo
			// This catches the case where user forgot to set isExistingRepository: true
			if (!r.config.isExistingRepository) {
				const isAlreadyRepo = await restic
					.snapshots({ ...r.config, isExistingRepository: true } as RepositoryConfig)
					.then(() => true)
					.catch((e) => {
						logger.debug(`Repo existence check for '${r.name}': ${toError(e).message}`);
						return false;
					});

				if (isAlreadyRepo) {
					logger.warn(
						`Skipping '${r.name}': location is already a restic repository. ` +
							`Set "isExistingRepository": true to import it, or use a different location for a new repository.`,
					);
					result.warnings++;
					continue;
				}
			}

			// Skip if a repository with the same name already exists (fallback for repos without deterministic paths)
			// Repository names are stored trimmed
			if (existingNames.has(r.name.trim())) {
				logger.info(`Repository '${r.name}': a repository with this name already exists`);
				result.skipped++;
				continue;
			}

			const compressionMode =
				r.compressionMode === "auto" || r.compressionMode === "off" || r.compressionMode === "max"
					? r.compressionMode
					: undefined;
			// Pass shortId from config if provided (for IaC reproducibility)
			const shortId = typeof r.shortId === "string" ? r.shortId : undefined;
			await repoServiceModule.repositoriesService.createRepository(
				r.name,
				r.config as RepositoryConfig,
				compressionMode,
				shortId,
			);
			logger.info(`Initialized repository from config: ${r.name}`);
			result.succeeded++;
		} catch (e) {
			const repoName = isRecord(r) && typeof r.name === "string" ? r.name : "unknown";
			logger.warn(`Repository '${repoName}' not created: ${toError(e).message}`);
			result.warnings++;
		}
	}

	return result;
}

async function importNotificationDestinations(notificationDestinations: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };
	const notificationsServiceModule = await import("../notifications/notifications.service");

	// Get existing destinations to check for duplicates
	const existingDestinations = await notificationsServiceModule.notificationsService.listDestinations();
	const existingNames = new Set(existingDestinations.map((d) => d.name));

	for (const n of notificationDestinations) {
		try {
			if (!isRecord(n) || typeof n.name !== "string" || !isRecord(n.config) || typeof n.config.type !== "string") {
				throw new Error("Invalid notification destination entry");
			}

			// The service uses slugify to normalize the name, so we check against stored names
			const slugifiedName = slugify(n.name, { lower: true, strict: true });
			if (existingNames.has(slugifiedName)) {
				logger.info(`Notification destination '${n.name}' already exists`);
				result.skipped++;
				continue;
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
			const destName = isRecord(n) && typeof n.name === "string" ? n.name : "unknown";
			logger.warn(`Notification destination '${destName}' not created: ${toError(e).message}`);
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
	destinationName: string;
	notifyOnStart: boolean;
	notifyOnSuccess: boolean;
	notifyOnWarning: boolean;
	notifyOnFailure: boolean;
};

function buildScheduleNotificationAssignments(
	scheduleName: string,
	notifications: unknown[],
	destinationBySlug: Map<string, { id: number; name: string }>,
): { assignments: ScheduleNotificationAssignment[]; warnings: number } {
	const assignments: ScheduleNotificationAssignment[] = [];
	let warnings = 0;

	for (const notif of notifications) {
		const destName = typeof notif === "string" ? notif : isRecord(notif) ? notif.name : null;
		if (typeof destName !== "string" || destName.length === 0) {
			logger.warn(`Notification destination missing name for schedule '${scheduleName}'`);
			warnings++;
			continue;
		}
		const destSlug = slugify(destName, { lower: true, strict: true });
		const dest = destinationBySlug.get(destSlug);
		if (!dest) {
			logger.warn(`Notification destination '${destName}' not found for schedule '${scheduleName}'`);
			warnings++;
			continue;
		}
		assignments.push({
			destinationId: dest.id,
			destinationName: dest.name,
			notifyOnStart: isRecord(notif) && typeof notif.notifyOnStart === "boolean" ? notif.notifyOnStart : true,
			notifyOnSuccess: isRecord(notif) && typeof notif.notifyOnSuccess === "boolean" ? notif.notifyOnSuccess : true,
			notifyOnWarning: isRecord(notif) && typeof notif.notifyOnWarning === "boolean" ? notif.notifyOnWarning : true,
			notifyOnFailure: isRecord(notif) && typeof notif.notifyOnFailure === "boolean" ? notif.notifyOnFailure : true,
		});
	}

	return { assignments, warnings };
}

async function attachScheduleNotifications(
	scheduleId: number,
	scheduleName: string,
	notifications: unknown[],
	destinationBySlug: Map<string, { id: number; name: string }>,
	notificationsServiceModule: typeof import("../notifications/notifications.service"),
): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };
	try {
		const existingNotifications =
			await notificationsServiceModule.notificationsService.getScheduleNotifications(scheduleId);
		const existingDestIds = new Set(existingNotifications.map((n) => n.destinationId));

		const { assignments, warnings } = buildScheduleNotificationAssignments(
			scheduleName,
			notifications,
			destinationBySlug,
		);
		result.warnings += warnings;

		// Filter out already attached notifications and track skipped
		const newAssignments: typeof assignments = [];
		for (const a of assignments) {
			if (existingDestIds.has(a.destinationId)) {
				logger.info(`Notification '${a.destinationName}' already attached to schedule '${scheduleName}'`);
				result.skipped++;
			} else {
				newAssignments.push(a);
			}
		}
		if (newAssignments.length === 0) return result;

		// Merge existing with new (strip destinationName for API call)
		const mergedAssignments = [
			...existingNotifications.map((n) => ({
				destinationId: n.destinationId,
				notifyOnStart: n.notifyOnStart,
				notifyOnSuccess: n.notifyOnSuccess,
				notifyOnWarning: n.notifyOnWarning,
				notifyOnFailure: n.notifyOnFailure,
			})),
			...newAssignments.map(({ destinationName: _, ...rest }) => rest),
		];

		await notificationsServiceModule.notificationsService.updateScheduleNotifications(scheduleId, mergedAssignments);
		const notifNames = newAssignments.map((a) => a.destinationName).join(", ");
		logger.info(`Assigned notification(s) [${notifNames}] to schedule '${scheduleName}'`);
		result.succeeded += newAssignments.length;
	} catch (e) {
		logger.warn(`Failed to assign notifications to schedule '${scheduleName}': ${toError(e).message}`);
		result.warnings++;
	}
	return result;
}

async function importBackupSchedules(backupSchedules: unknown[]): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };
	if (!Array.isArray(backupSchedules) || backupSchedules.length === 0) return result;

	const backupServiceModule = await import("../backups/backups.service");
	const notificationsServiceModule = await import("../notifications/notifications.service");

	const volumes = await db.query.volumesTable.findMany();
	const repositories = await db.query.repositoriesTable.findMany();
	const destinations = await db.query.notificationDestinationsTable.findMany();
	const existingSchedules = await db.query.backupSchedulesTable.findMany();

	const volumeByName = new Map(volumes.map((v) => [v.name, v] as const));
	const repoByName = new Map(repositories.map((r) => [r.name, r] as const));
	const destinationBySlug = new Map(destinations.map((d) => [d.name, d] as const));
	const scheduleByName = new Map(existingSchedules.map((s) => [s.name, s] as const));

	for (const s of backupSchedules) {
		if (!isRecord(s)) {
			continue;
		}
		const volumeName = getScheduleVolumeName(s);
		if (typeof volumeName !== "string" || volumeName.length === 0) {
			logger.warn("Backup schedule not processed: Missing volume name");
			result.warnings++;
			continue;
		}
		// Volume names are stored slugified
		const volumeSlug = slugify(volumeName, { lower: true, strict: true });
		const volume = volumeByName.get(volumeSlug);
		if (!volume) {
			logger.warn(`Backup schedule not processed: Volume '${volumeName}' not found`);
			result.warnings++;
			continue;
		}

		const repositoryName = getScheduleRepositoryName(s);
		if (typeof repositoryName !== "string" || repositoryName.length === 0) {
			logger.warn("Backup schedule not processed: Missing repository name");
			result.warnings++;
			continue;
		}
		// Repository names are stored trimmed
		const repository = repoByName.get(repositoryName.trim());
		if (!repository) {
			logger.warn(`Backup schedule not processed: Repository '${repositoryName}' not found`);
			result.warnings++;
			continue;
		}

		const scheduleName = typeof s.name === "string" && s.name.length > 0 ? s.name : `${volumeName}-${repositoryName}`;
		if (typeof s.cronExpression !== "string" || s.cronExpression.length === 0) {
			logger.warn(`Backup schedule not processed: Missing cronExpression for '${scheduleName}'`);
			result.warnings++;
			continue;
		}

		// Check if schedule already exists - if so, skip creation but still try attachments
		const existingSchedule = scheduleByName.get(scheduleName);
		let scheduleId: number;

		if (existingSchedule) {
			logger.info(`Backup schedule '${scheduleName}' already exists`);
			result.skipped++;
			scheduleId = existingSchedule.id;
		} else {
			// Mount volume if needed for new schedule
			if (volume.status !== "mounted") {
				try {
					await volumeService.mountVolume(volume.name);
					volumeByName.set(volume.name, { ...volume, status: "mounted" });
					logger.info(`Mounted volume ${volume.name} for backup schedule`);
				} catch (e) {
					logger.warn(`Could not mount volume ${volume.name}: ${toError(e).message}`);
					result.warnings++;
					continue;
				}
			}

			try {
				const retentionPolicy = isRecord(s.retentionPolicy) ? (s.retentionPolicy as RetentionPolicy) : undefined;
				// Pass shortId from config if provided (for IaC reproducibility)
				const providedShortId = typeof s.shortId === "string" ? s.shortId : undefined;
				const createdSchedule = await backupServiceModule.backupsService.createSchedule(
					{
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
					},
					providedShortId,
				);
				logger.info(`Initialized backup schedule from config: ${scheduleName}`);
				result.succeeded++;
				scheduleId = createdSchedule.id;
			} catch (e) {
				logger.warn(`Backup schedule '${scheduleName}' not created: ${toError(e).message}`);
				result.warnings++;
				continue;
			}
		}

		// Attach notifications (checks if already attached)
		if (Array.isArray(s.notifications) && s.notifications.length > 0) {
			const notifResult = await attachScheduleNotifications(
				scheduleId,
				scheduleName,
				s.notifications,
				destinationBySlug,
				notificationsServiceModule,
			);
			mergeResults(result, notifResult);
		}

		// Attach mirrors (checks if already attached)
		if (Array.isArray(s.mirrors) && s.mirrors.length > 0) {
			const mirrorResult = await attachScheduleMirrors(
				scheduleId,
				scheduleName,
				s.mirrors,
				repoByName,
				backupServiceModule,
			);
			mergeResults(result, mirrorResult);
		}
	}

	return result;
}

async function attachScheduleMirrors(
	scheduleId: number,
	scheduleName: string,
	mirrors: unknown[],
	repoByName: Map<string, { id: string; name: string; config: RepositoryConfig }>,
	backupServiceModule: typeof import("../backups/backups.service"),
): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };
	try {
		const existingMirrors = await backupServiceModule.backupsService.getMirrors(scheduleId);
		const existingRepoIds = new Set(existingMirrors.map((m) => m.repositoryId));

		const mirrorConfigs: Array<{
			repositoryId: string;
			repositoryName: string;
			enabled: boolean;
		}> = [];

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
				logger.warn(`Mirror missing repository name for schedule '${scheduleName}'`);
				result.warnings++;
				continue;
			}

			// Repository names are stored trimmed
			const repo = repoByName.get(repoName.trim());
			if (!repo) {
				logger.warn(`Mirror repository '${repoName}' not found for schedule '${scheduleName}'`);
				result.warnings++;
				continue;
			}

			mirrorConfigs.push({
				repositoryId: repo.id,
				repositoryName: repo.name,
				enabled: typeof m.enabled === "boolean" ? m.enabled : true,
			});
		}

		// Filter out already attached mirrors and track skipped
		const newMirrors: typeof mirrorConfigs = [];
		for (const m of mirrorConfigs) {
			if (existingRepoIds.has(m.repositoryId)) {
				logger.info(`Mirror '${m.repositoryName}' already attached to schedule '${scheduleName}'`);
				result.skipped++;
			} else {
				newMirrors.push(m);
			}
		}
		if (newMirrors.length === 0) return result;

		// Merge existing with new (strip repositoryName for API call)
		const mergedMirrors = [
			...existingMirrors.map((m) => ({
				repositoryId: m.repositoryId,
				enabled: m.enabled,
			})),
			...newMirrors.map(({ repositoryName: _, ...rest }) => rest),
		];

		await backupServiceModule.backupsService.updateMirrors(scheduleId, { mirrors: mergedMirrors });
		const mirrorNames = newMirrors.map((m) => m.repositoryName).join(", ");
		logger.info(`Assigned mirror(s) [${mirrorNames}] to schedule '${scheduleName}'`);
		result.succeeded += newMirrors.length;
	} catch (e) {
		logger.warn(`Failed to assign mirrors to schedule '${scheduleName}': ${toError(e).message}`);
		result.warnings++;
	}
	return result;
}

async function importUsers(users: unknown[], recoveryKey: string | null): Promise<ImportResult> {
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };

	try {
		const { authService } = await import("../auth/auth.service");
		const hasUsers = await authService.hasUsers();
		if (hasUsers) {
			if (Array.isArray(users) && users.length > 0) {
				logger.info("Users already exist; skipping user import from config");
				result.skipped++;
			}
			return result;
		}
		if (!Array.isArray(users) || users.length === 0) return result;

		if (users.length > 1) {
			logger.warn(
				"Multiple users provided in config. Zerobyte currently supports a single initial user; extra entries will be ignored.",
			);
			result.warnings++;
		}

		for (const u of users) {
			if (!isRecord(u)) {
				logger.warn("Invalid user entry in config; skipping");
				result.warnings++;
				continue;
			}
			if (typeof u.username !== "string" || u.username.length === 0) {
				logger.warn("User entry missing username; skipping");
				result.warnings++;
				continue;
			}

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
	const result: ImportResult = { succeeded: 0, skipped: 0, warnings: 0, errors: 0 };

	mergeResults(result, await writeRecoveryKeyFromConfig(config.recoveryKey));

	// Stop immediately if recovery key has errors (e.g., mismatch with existing key)
	if (result.errors > 0) {
		return result;
	}

	mergeResults(result, await importVolumes(config.volumes));
	mergeResults(result, await importRepositories(config.repositories));
	mergeResults(result, await importNotificationDestinations(config.notificationDestinations));
	mergeResults(result, await importBackupSchedules(config.backupSchedules));
	mergeResults(result, await importUsers(config.users, config.recoveryKey));

	return result;
}

function logImportSummary(result: ImportResult): void {
	const skippedMsg = result.skipped > 0 ? `, ${result.skipped} skipped` : "";
	if (result.errors > 0) {
		logger.error(
			`Config import completed with ${result.errors} error(s) and ${result.warnings} warning(s), ${result.succeeded} imported${skippedMsg}`,
		);
	} else if (result.warnings > 0) {
		logger.warn(
			`Config import completed with ${result.warnings} warning(s), ${result.succeeded} imported${skippedMsg}`,
		);
	} else if (result.succeeded > 0 || result.skipped > 0) {
		logger.info(`Config import completed: ${result.succeeded} imported${skippedMsg}`);
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
		logger.error(`Config import failed: ${toError(e).message}`);
	}
}
