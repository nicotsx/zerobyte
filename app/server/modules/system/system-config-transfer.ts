import { eq } from "drizzle-orm";
import { z } from "zod";
import { BANDWIDTH_UNITS, resticStatsSchema } from "@zerobyte/core/restic";
import { db } from "~/server/db/db";
import {
	backupScheduleMirrorsTable,
	backupScheduleNotificationsTable,
	backupSchedulesTable,
	notificationDestinationsTable,
	organization,
	repositoriesTable,
	usersTable,
	volumesTable,
} from "~/server/db/schema";
import { createBackupScheduleResponse, scheduleMirrorAssignmentSchema } from "~/server/modules/backups/backups.dto";
import {
	notificationDestinationSchema,
	scheduleNotificationAssignmentSchema,
} from "~/server/modules/notifications/notifications.dto";
import { repositorySchema } from "~/server/modules/repositories/repositories.dto";
import {
	decryptRepositoryConfig,
	encryptRepositoryConfig,
} from "~/server/modules/repositories/repository-config-secrets";
import { decryptVolumeConfig, encryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { volumeSchema } from "~/server/modules/volumes/volume.dto";
import {
	decryptNotificationConfig,
	encryptNotificationConfig,
} from "~/server/modules/notifications/notification-config-secrets";
import { cryptoUtils } from "~/server/utils/crypto";
import { asShortId } from "~/server/utils/branded";

const exportedRepositorySchema = repositorySchema.extend({
	id: z.string().min(1),
	shortId: z.string().min(1),
	name: z.string().min(1),
	stats: resticStatsSchema.nullable(),
	statsUpdatedAt: z.number().nullable(),
	uploadLimitEnabled: z.boolean(),
	uploadLimitValue: z.number(),
	uploadLimitUnit: z.enum(BANDWIDTH_UNITS),
	downloadLimitEnabled: z.boolean(),
	downloadLimitValue: z.number(),
	downloadLimitUnit: z.enum(BANDWIDTH_UNITS),
});

const exportedVolumeSchema = volumeSchema.extend({
	id: z.number().int(),
	shortId: z.string().min(1),
	name: z.string().min(1),
});

const exportedBackupScheduleSchema = createBackupScheduleResponse.extend({
	id: z.number().int(),
	shortId: z.string().min(1),
	name: z.string().min(1),
	volumeId: z.number().int(),
	repositoryId: z.string().min(1),
	sortOrder: z.number(),
});

const exportedNotificationDestinationSchema = notificationDestinationSchema.extend({
	id: z.number().int(),
	name: z.string().min(1),
});

const exportedBackupScheduleMirrorSchema = scheduleMirrorAssignmentSchema.extend({
	id: z.number().int(),
	scheduleId: z.number().int(),
	repositoryId: z.string().min(1),
});

const exportedBackupScheduleNotificationSchema = scheduleNotificationAssignmentSchema
	.omit({ destination: true })
	.extend({
		scheduleId: z.number().int(),
		destinationId: z.number().int(),
	});

const configTransferPayloadSchema = z.object({
	version: z.literal(1),
	repositories: z.array(exportedRepositorySchema),
	volumes: z.array(exportedVolumeSchema),
	backupSchedules: z.array(exportedBackupScheduleSchema),
	notificationDestinations: z.array(exportedNotificationDestinationSchema),
	backupScheduleMirrors: z.array(exportedBackupScheduleMirrorSchema),
	backupScheduleNotifications: z.array(exportedBackupScheduleNotificationSchema),
});

const configTransferPrefix = "zbcfgv1:";
const decodeEncryptedPayload = async (encryptedConfig: string, resticPassword: string) => {
	const decryptedPayload = await cryptoUtils.decryptWithSecret(encryptedConfig, {
		prefix: configTransferPrefix,
		secret: resticPassword,
	});
	const parsed = JSON.parse(decryptedPayload) as unknown;

	return configTransferPayloadSchema.parse(parsed);
};

export const isOrganizationConfigEmpty = async (organizationId: string) => {
	const [repository, volume, schedule, destination] = await Promise.all([
		db.query.repositoriesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.volumesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.backupSchedulesTable.findFirst({ where: { organizationId }, columns: { id: true } }),
		db.query.notificationDestinationsTable.findFirst({ where: { organizationId }, columns: { id: true } }),
	]);

	return !repository && !volume && !schedule && !destination;
};

export const createEncryptedOrganizationConfigExport = async (organizationId: string, resticPassword: string) => {
	const [repositories, volumes, backupSchedules, notificationDestinations] = await Promise.all([
		db.query.repositoriesTable.findMany({ where: { organizationId } }),
		db.query.volumesTable.findMany({ where: { organizationId } }),
		db.query.backupSchedulesTable.findMany({ where: { organizationId } }),
		db.query.notificationDestinationsTable.findMany({ where: { organizationId } }),
	]);

	const scheduleIds = backupSchedules.map((schedule) => schedule.id);

	const [backupScheduleMirrors, backupScheduleNotifications] =
		scheduleIds.length === 0
			? [[], []]
			: await Promise.all([
					db.query.backupScheduleMirrorsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
					db.query.backupScheduleNotificationsTable.findMany({ where: { scheduleId: { in: scheduleIds } } }),
				]);

	const [decryptedRepositories, decryptedVolumes, decryptedNotificationDestinations] = await Promise.all([
		Promise.all(
			repositories.map(async (repository) => ({
				...repository,
				config: await decryptRepositoryConfig(repository.config),
			})),
		),
		Promise.all(
			volumes.map(async (volume) => ({
				...volume,
				config: await decryptVolumeConfig(volume.config),
			})),
		),
		Promise.all(
			notificationDestinations.map(async (destination) => ({
				...destination,
				config: await decryptNotificationConfig(destination.config),
			})),
		),
	]);

	const payload = configTransferPayloadSchema.parse({
		version: 1,
		repositories: decryptedRepositories,
		volumes: decryptedVolumes,
		backupSchedules,
		notificationDestinations: decryptedNotificationDestinations,
		backupScheduleMirrors,
		backupScheduleNotifications,
	});

	return await cryptoUtils.encryptWithSecret(JSON.stringify(payload), {
		prefix: configTransferPrefix,
		secret: resticPassword,
	});
};

export const importEncryptedOrganizationConfig = async (
	organizationId: string,
	userId: string,
	encryptedConfig: string,
	resticPassword: string,
) => {
	const parsedPayload = await decodeEncryptedPayload(encryptedConfig, resticPassword);

	const [encryptedRepositories, encryptedVolumes, encryptedNotificationDestinations] = await Promise.all([
		Promise.all(
			parsedPayload.repositories.map(async (repository) => ({
				...repository,
				config: await encryptRepositoryConfig(repository.config),
			})),
		),
		Promise.all(
			parsedPayload.volumes.map(async (volume) => ({
				...volume,
				config: await encryptVolumeConfig(volume.config),
			})),
		),
		Promise.all(
			parsedPayload.notificationDestinations.map(async (destination) => ({
				...destination,
				config: await encryptNotificationConfig(destination.config),
			})),
		),
	]);

	const sealedResticPassword = await cryptoUtils.sealSecret(resticPassword);

	db.transaction((tx) => {
		const org = tx.query.organization.findFirst({ where: { id: organizationId }, columns: { metadata: true } }).sync();
		const volumeIdMap = new Map<number, number>();
		const scheduleIdMap = new Map<number, number>();

		if (!org) {
			throw new Error("Organization not found");
		}

		for (const repository of encryptedRepositories) {
			tx.insert(repositoriesTable)
				.values({
					...repository,
					shortId: asShortId(repository.shortId),
					organizationId,
				})
				.run();
		}

		for (const volume of encryptedVolumes) {
			const { id: sourceVolumeId, shortId, ...volumeValues } = volume;
			const importedVolumeShortId = asShortId(shortId);

			tx.insert(volumesTable)
				.values({
					...volumeValues,
					shortId: importedVolumeShortId,
					organizationId,
				})
				.run();

			const insertedVolume = tx.query.volumesTable
				.findFirst({
					where: {
						AND: [{ shortId: { eq: importedVolumeShortId } }, { organizationId }],
					},
					columns: { id: true },
				})
				.sync();

			if (!insertedVolume) {
				throw new Error(`Imported volume ${shortId} not found`);
			}

			volumeIdMap.set(sourceVolumeId, insertedVolume.id);
		}

		for (const schedule of parsedPayload.backupSchedules) {
			const { id: sourceScheduleId, shortId, volumeId: sourceVolumeId, ...scheduleValues } = schedule;
			const mappedVolumeId = volumeIdMap.get(sourceVolumeId);

			if (!mappedVolumeId) {
				throw new Error(`Imported volume ${sourceVolumeId} not found`);
			}

			const importedScheduleShortId = asShortId(shortId);

			tx.insert(backupSchedulesTable)
				.values({
					...scheduleValues,
					shortId: importedScheduleShortId,
					volumeId: mappedVolumeId,
					organizationId,
				})
				.run();

			const insertedSchedule = tx.query.backupSchedulesTable
				.findFirst({
					where: {
						AND: [{ shortId: { eq: importedScheduleShortId } }, { organizationId }],
					},
					columns: { id: true },
				})
				.sync();

			if (!insertedSchedule) {
				throw new Error(`Imported backup schedule ${shortId} not found`);
			}

			scheduleIdMap.set(sourceScheduleId, insertedSchedule.id);
		}

		for (const destination of encryptedNotificationDestinations) {
			tx.insert(notificationDestinationsTable)
				.values({
					...destination,
					organizationId,
				})
				.run();
		}

		for (const mirror of parsedPayload.backupScheduleMirrors) {
			const mappedScheduleId = scheduleIdMap.get(mirror.scheduleId);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${mirror.scheduleId} not found`);
			}

			tx.insert(backupScheduleMirrorsTable)
				.values({
					scheduleId: mappedScheduleId,
					repositoryId: mirror.repositoryId,
					enabled: mirror.enabled,
					lastCopyAt: mirror.lastCopyAt,
					lastCopyStatus: mirror.lastCopyStatus,
					lastCopyError: mirror.lastCopyError,
					createdAt: mirror.createdAt,
				})
				.run();
		}

		for (const notification of parsedPayload.backupScheduleNotifications) {
			const { scheduleId: sourceScheduleId, ...notificationValues } = notification;
			const mappedScheduleId = scheduleIdMap.get(sourceScheduleId);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${sourceScheduleId} not found`);
			}

			tx.insert(backupScheduleNotificationsTable)
				.values({
					...notificationValues,
					scheduleId: mappedScheduleId,
				})
				.run();
		}

		tx.update(organization)
			.set({ metadata: { ...(org.metadata ?? {}), resticPassword: sealedResticPassword } })
			.where(eq(organization.id, organizationId))
			.run();

		tx.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId)).run();
	});

	return {
		repositories: parsedPayload.repositories.length,
		volumes: parsedPayload.volumes.length,
		backupSchedules: parsedPayload.backupSchedules.length,
		notificationDestinations: parsedPayload.notificationDestinations.length,
		backupScheduleMirrors: parsedPayload.backupScheduleMirrors.length,
		backupScheduleNotifications: parsedPayload.backupScheduleNotifications.length,
	};
};
