import { Scheduler } from "../../core/scheduler";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../db/db";
import { volumesTable, usersTable, repositoriesTable, notificationDestinationsTable } from "../../db/schema";
import { logger } from "../../utils/logger";
import { restic } from "../../utils/restic";
import { volumeService } from "../volumes/volume.service";
import { CleanupDanglingMountsJob } from "../../jobs/cleanup-dangling";
import { VolumeHealthCheckJob } from "../../jobs/healthchecks";
import { RepositoryHealthCheckJob } from "../../jobs/repository-healthchecks";
import { BackupExecutionJob } from "../../jobs/backup-execution";
import { CleanupSessionsJob } from "../../jobs/cleanup-sessions";

export const startup = async () => {
	let configFileVolumes = [];
	let configFileRepositories = [];
	let configFileBackupSchedules = [];
	let configFileNotificationDestinations = [];
	let configFileAdmin = null;
	try {
		const configPath = process.env.ZEROBYTE_CONFIG_PATH || "zerobyte.config.json";
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const configFullPath = path.resolve(process.cwd(), configPath);
		if (await fs.stat(configFullPath).then(() => true, () => false)) {
			const raw = await fs.readFile(configFullPath, "utf-8");
			const config = JSON.parse(raw);

			function interpolate(obj) {
				if (typeof obj === "string") {
					return obj.replace(/\$\{([^}]+)\}/g, (_, v) => {
						if (process.env[v] === undefined) {
							logger.warn(`Environment variable '${v}' is not defined. Replacing with empty string.`);
							return "";
						}
						return process.env[v];
					});
				} else if (Array.isArray(obj)) {
					return obj.map(interpolate);
				} else if (obj && typeof obj === "object") {
					return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, interpolate(v)]));
				}
				return obj;
			}
			configFileVolumes = interpolate(config.volumes || []);
			configFileRepositories = interpolate(config.repositories || []);
			configFileBackupSchedules = interpolate(config.backupSchedules || []);
			configFileNotificationDestinations = interpolate(config.notificationDestinations || []);
			configFileAdmin = interpolate(config.admin || null);
		}
	} catch (e) {
		logger.warn(`No config file loaded or error parsing config: ${e.message}`);
	}

	await Scheduler.start();
	await Scheduler.clear();

	try {
		const fs = await import("node:fs/promises");
		const { RESTIC_PASS_FILE } = await import("../../core/constants.js");
		if (configFileAdmin && configFileAdmin.recoveryKey) {
			const recoveryKey = configFileAdmin.recoveryKey;
			if (
				typeof recoveryKey !== "string" ||
				recoveryKey.length !== 64 ||
				!/^[a-fA-F0-9]{64}$/.test(recoveryKey)
			) {
				throw new Error("Recovery key must be a 64-character hex string");
			}
			await fs.writeFile(RESTIC_PASS_FILE, recoveryKey, { mode: 0o600 });
			logger.info(`Recovery key written from config to ${RESTIC_PASS_FILE}`);
		}
	} catch (err) {
		const e = err instanceof Error ? err : new Error(String(err));
		logger.error(`Failed to write recovery key from config: ${e.message}`);
	}

	await restic.ensurePassfile().catch((err) => {
		logger.error(`Error ensuring restic passfile exists: ${err.message}`);
	});

	try {
		for (const v of configFileVolumes) {
			try {
				await volumeService.createVolume(v.name, v.config);
				logger.info(`Initialized volume from config: ${v.name}`);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Volume ${v.name} not created: ${err.message}`);
			}
		}
		const repoServiceModule = await import("../repositories/repositories.service");
		for (const r of configFileRepositories) {
			try {
				await repoServiceModule.repositoriesService.createRepository(r.name, r.config, r.compressionMode);
				logger.info(`Initialized repository from config: ${r.name}`);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Repository ${r.name} not created: ${err.message}`);
			}
		}
		const notificationsServiceModule = await import("../notifications/notifications.service");
		for (const n of configFileNotificationDestinations) {
			try {
				await notificationsServiceModule.notificationsService.createDestination(n.name, n.config);
				logger.info(`Initialized notification destination from config: ${n.name}`);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Notification destination ${n.name} not created: ${err.message}`);
			}
		}

		const backupServiceModule = await import("../backups/backups.service");
		for (const s of configFileBackupSchedules) {
			const volumeName = s.volume || s.volumeName;
			const volume = await db.query.volumesTable.findFirst({
				where: eq(volumesTable.name, volumeName),
			});
			if (!volume) {
				logger.warn(`Backup schedule not created: Volume '${volumeName}' not found`);
				continue;
			}
			const repositoryName = s.repository || s.repositoryName;
			const repository = await db.query.repositoriesTable.findFirst({
				where: eq(repositoriesTable.name, repositoryName),
			});
			if (!repository) {
				logger.warn(`Backup schedule not created: Repository '${repositoryName}' not found`);
				continue;
			}
			if (volume.status !== "mounted") {
				try {
					await volumeService.mountVolume(volume.name);
					logger.info(`Mounted volume ${volume.name} for backup schedule`);
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e));
					logger.warn(`Could not mount volume ${volume.name}: ${err.message}`);
					continue;
				}
			}
			let createdSchedule;
			try {
				createdSchedule = await backupServiceModule.backupsService.createSchedule({
					...s,
					volumeId: volume.id,
					repositoryId: repository.id,
				});
				logger.info(`Initialized backup schedule from config: ${s.cronExpression || s.name}`);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				logger.warn(`Backup schedule not created: ${err.message}`);
				continue;
			}

			if (createdSchedule && s.notifications && Array.isArray(s.notifications) && s.notifications.length > 0) {
				try {
					const assignments: Array<{
						destinationId: number;
						notifyOnStart: boolean;
						notifyOnSuccess: boolean;
						notifyOnFailure: boolean;
					}> = [];
					for (const notif of s.notifications) {
						const destName = typeof notif === 'string' ? notif : notif.name;
						const dest = await db.query.notificationDestinationsTable.findFirst({
							where: eq(notificationDestinationsTable.name, destName),
						});
						if (dest) {
							assignments.push({
								destinationId: dest.id,
								notifyOnStart: typeof notif === 'object' ? (notif.notifyOnStart ?? true) : true,
								notifyOnSuccess: typeof notif === 'object' ? (notif.notifyOnSuccess ?? true) : true,
								notifyOnFailure: typeof notif === 'object' ? (notif.notifyOnFailure ?? true) : true,
							});
						} else {
							logger.warn(`Notification destination '${destName}' not found for schedule`);
						}
					}
					if (assignments.length > 0) {
						await notificationsServiceModule.notificationsService.updateScheduleNotifications(createdSchedule.id, assignments);
						logger.info(`Assigned ${assignments.length} notification(s) to backup schedule`);
					}
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e));
					logger.warn(`Failed to assign notifications to schedule: ${err.message}`);
				}
			}

		}
		
		try {
			const { authService } = await import("../auth/auth.service");
			if (configFileAdmin && configFileAdmin.username && (configFileAdmin.password || configFileAdmin.passwordHash)) {
				if (configFileAdmin.password && configFileAdmin.passwordHash) {
					logger.error("Config error: Both 'password' and 'passwordHash' provided for admin user. Use only one.");
					throw new Error("Invalid admin configuration");
				}
				const hasUsers = await authService.hasUsers();
				if (!hasUsers) {
					let userId: number;
					if (configFileAdmin.passwordHash) {
						// Import with existing password hash (migration from another instance)
						const [user] = await db.insert(usersTable).values({
							username: configFileAdmin.username,
							passwordHash: configFileAdmin.passwordHash,
						}).returning();
						userId = user.id;
						logger.info(`Admin user '${configFileAdmin.username}' imported with password hash from config.`);
					} else {
						// Create new user with plaintext password
						const { user } = await authService.register(configFileAdmin.username, configFileAdmin.password);
						userId = user.id;
						logger.info(`Admin user '${configFileAdmin.username}' created from config.`);
					}
					if (configFileAdmin.recoveryKey) {
						await db.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId));
					}
				}
			} else if (configFileAdmin) {
				logger.warn("Admin config missing required fields (username, password or passwordHash). Skipping automated admin setup.");
			}
		} catch (err) {
			const e = err instanceof Error ? err : new Error(String(err));
			logger.error(`Automated admin setup failed: ${e.message}`);
		}
	} catch (e) {
		const err = e instanceof Error ? e : new Error(String(e));
		logger.error(`Failed to initialize from config: ${err.message}`);
	}

	const volumes = await db.query.volumesTable.findMany({
		where: or(
			eq(volumesTable.status, "mounted"),
			and(eq(volumesTable.autoRemount, true), eq(volumesTable.status, "error")),
		),
	});

	for (const volume of volumes) {
		await volumeService.mountVolume(volume.name).catch((err) => {
			logger.error(`Error auto-remounting volume ${volume.name} on startup: ${err.message}`);
		});
	}

	Scheduler.build(CleanupDanglingMountsJob).schedule("0 * * * *");
	Scheduler.build(VolumeHealthCheckJob).schedule("*/30 * * * *");
	Scheduler.build(RepositoryHealthCheckJob).schedule("50 12 * * *");
	Scheduler.build(BackupExecutionJob).schedule("* * * * *");
	Scheduler.build(CleanupSessionsJob).schedule("0 0 * * *");
};
