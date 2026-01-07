import { getCapabilities } from "../../core/capabilities";
import { config } from "../../core/config";
import type { UpdateInfoDto } from "./system.dto";
import semver from "semver";
import { cache } from "../../utils/cache";
import { logger } from "~/server/utils/logger";
import { db } from "~/server/db/db";
import {
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	repositoriesTable,
	usersTable,
	volumesTable,
	type BackupScheduleMirror,
	type BackupScheduleNotification,
	type BackupSchedule,
} from "~/server/db/schema";

type ExportParams = {
	includeMetadata: boolean;
};

const CACHE_TTL = 60 * 60;

const getSystemInfo = async () => {
	return {
		capabilities: await getCapabilities(),
	};
};

interface GitHubRelease {
	tag_name: string;
	html_url: string;
	published_at: string;
	body: string;
}

const getUpdates = async (): Promise<UpdateInfoDto> => {
	const CACHE_KEY = `system:updates:${config.appVersion}`;

	const cached = cache.get<UpdateInfoDto>(CACHE_KEY);
	if (cached) {
		return cached;
	}

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 5000);

		const response = await fetch("https://api.github.com/repos/nicotsx/zerobyte/releases", {
			signal: controller.signal,
			headers: {
				"User-Agent": "zerobyte-app",
			},
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			throw new Error(`GitHub API returned ${response.status}`);
		}

		const releases = (await response.json()) as GitHubRelease[];
		const currentVersion = config.appVersion;

		const formattedReleases = releases.map((r) => ({
			version: r.tag_name,
			url: r.html_url,
			publishedAt: r.published_at,
			body: r.body,
		}));

		const latestRelease = formattedReleases[0];
		const latestVersion = latestRelease?.version ?? currentVersion;

		const hasUpdate = !!(
			currentVersion !== "dev" &&
			semver.valid(currentVersion) &&
			semver.valid(latestVersion) &&
			semver.gt(latestVersion, currentVersion)
		);

		const missedReleases =
			currentVersion === "dev" || !semver.valid(currentVersion)
				? []
				: formattedReleases.filter((r) => !!(semver.valid(r.version) && semver.gt(r.version, currentVersion)));

		const data: UpdateInfoDto = {
			currentVersion,
			latestVersion,
			hasUpdate,
			missedReleases,
		};

		cache.set(CACHE_KEY, data, CACHE_TTL);

		return data;
	} catch (error) {
		logger.error("Failed to fetch updates from GitHub:", error);
		return {
			currentVersion: config.appVersion,
			latestVersion: config.appVersion,
			hasUpdate: false,
			missedReleases: [],
		};
	}
};

const METADATA_KEYS = {
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

const ALL_METADATA_KEYS = [...METADATA_KEYS.timestamps, ...METADATA_KEYS.runtimeState];

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

async function exportEntity(entity: Record<string, unknown>, params: ExportParams) {
	return filterMetadataOut(entity, params.includeMetadata);
}

async function exportEntities<T extends Record<string, unknown>>(entities: T[], params: ExportParams) {
	return Promise.all(entities.map((e) => exportEntity(e, params)));
}

const transformBackupSchedules = (
	schedules: BackupSchedule[],
	scheduleNotifications: BackupScheduleNotification[],
	scheduleMirrors: BackupScheduleMirror[],
	params: ExportParams,
) => {
	return schedules.map((schedule) => {
		const assignments = scheduleNotifications
			.filter((sn) => sn.scheduleId === schedule.id)
			.map((sn) => filterMetadataOut(sn, params.includeMetadata));

		const mirrors = scheduleMirrors
			.filter((sm) => sm.scheduleId === schedule.id)
			.map((sm) => filterMetadataOut(sm, params.includeMetadata));

		return {
			...filterMetadataOut(schedule, params.includeMetadata),
			notifications: assignments,
			mirrors,
		};
	});
};

const exportConfig = async (params: ExportParams) => {
	const [volumes, repositories, backupSchedulesRaw, notifications, scheduleNotifications, scheduleMirrors, users] =
		await Promise.all([
			db.select().from(volumesTable),
			db.select().from(repositoriesTable),
			db.select().from(backupSchedulesTable),
			db.select().from(notificationDestinationsTable),
			db.select().from(backupScheduleNotificationsTable),
			db.select().from(backupScheduleMirrorsTable),
			db.select().from(usersTable),
		]);

	const backupSchedules = transformBackupSchedules(backupSchedulesRaw, scheduleNotifications, scheduleMirrors, params);

	const [exportVolumes, exportRepositories, exportNotifications, exportedUsersWithHash] = await Promise.all([
		exportEntities(volumes, params) as Promise<typeof volumes>,
		exportEntities(repositories, params) as Promise<typeof repositories>,
		exportEntities(notifications, params) as Promise<typeof notifications>,
		exportEntities(users, params) as Promise<typeof users>,
	]);

	const exportUsers = exportedUsersWithHash.map((user) => {
		const sanitizedUser = { ...user } as Record<string, unknown>;
		delete sanitizedUser.passwordHash;
		sanitizedUser.password = `\${USER_${user.username.toUpperCase()}_PASSWORD}`;
		return sanitizedUser;
	});

	return {
		version: 1,
		exportedAt: new Date().toISOString(),
		volumes: exportVolumes,
		repositories: exportRepositories,
		backupSchedules,
		notificationDestinations: exportNotifications,
		users: exportUsers,
	};
};

export const systemService = {
	getSystemInfo,
	getUpdates,
	exportConfig,
};
