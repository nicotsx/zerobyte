import { eq } from "drizzle-orm";
import { ConflictError } from "http-errors-enhanced";
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
import { calculateNextRun } from "~/server/modules/backups/backup.helpers";
import { bandwidthFields } from "~/server/modules/repositories/repository-bandwidth-fields";
import { asShortId } from "~/server/utils/branded";
import { generateShortId } from "~/server/utils/id";
import type { PreparedImport } from "./prepare-import";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const getRequiredId = <T>(ids: Map<string, T>, ref: string, label: string) => {
	const id = ids.get(ref);

	if (id === undefined) {
		throw new Error(`Imported ${label} ${ref} not found`);
	}

	return id;
};

const assertAllowed = (tx: Transaction, organizationId: string, userId: string) => {
	const user = tx.query.usersTable
		.findFirst({ where: { id: userId }, columns: { hasDownloadedResticPassword: true } })
		.sync();

	if (!user) {
		throw new Error("User not found");
	}
	if (user.hasDownloadedResticPassword) {
		throw new ConflictError("Configuration import is only available during onboarding");
	}

	const existingConfig = [
		tx.query.repositoriesTable.findFirst({ where: { organizationId }, columns: { id: true } }).sync(),
		tx.query.volumesTable.findFirst({ where: { organizationId }, columns: { id: true } }).sync(),
		tx.query.backupSchedulesTable.findFirst({ where: { organizationId }, columns: { id: true } }).sync(),
		tx.query.notificationDestinationsTable.findFirst({ where: { organizationId }, columns: { id: true } }).sync(),
	];

	if (existingConfig.some(Boolean)) {
		throw new ConflictError("Organization already contains configuration");
	}
};

export const assertImportAllowed = (organizationId: string, userId: string) => {
	db.transaction((tx) => assertAllowed(tx, organizationId, userId));
};

const importRepositories = (tx: Transaction, organizationId: string, repositories: PreparedImport["repositories"]) => {
	const ids = new Map<string, string>();

	for (const repository of repositories) {
		const id = Bun.randomUUIDv7();
		const bandwidth = bandwidthFields(repository.config);
		tx.insert(repositoriesTable)
			.values({
				id,
				shortId: generateShortId(),
				name: repository.name,
				type: repository.config.backend,
				config: repository.config,
				compressionMode: repository.compressionMode,
				status: "unknown",
				autoCheckEnabled: repository.autoCheckEnabled,
				...bandwidth,
				organizationId,
			})
			.run();
		ids.set(repository.ref, id);
	}

	return ids;
};

const importVolumes = (tx: Transaction, organizationId: string, volumes: PreparedImport["volumes"]) => {
	const ids = new Map<string, number>();

	for (const volume of volumes) {
		const inserted = tx
			.insert(volumesTable)
			.values({
				shortId: generateShortId(),
				name: volume.name,
				type: volume.config.backend,
				status: "unmounted",
				config: volume.config,
				autoRemount: volume.autoRemount,
				organizationId,
			})
			.returning({ id: volumesTable.id })
			.get();

		if (!inserted) {
			throw new Error(`Failed to import volume ${volume.ref}`);
		}
		ids.set(volume.ref, inserted.id);
	}

	return ids;
};

const importSchedules = (
	tx: Transaction,
	organizationId: string,
	schedules: PreparedImport["backupSchedules"],
	volumeIds: Map<string, number>,
	repositoryIds: Map<string, string>,
) => {
	const ids = new Map<string, number>();

	for (const schedule of schedules) {
		const nextBackupAt = schedule.cronExpression ? calculateNextRun(schedule.cronExpression) : null;
		const shortId = asShortId(schedule.shortId);
		const inserted = tx
			.insert(backupSchedulesTable)
			.values({
				shortId,
				name: schedule.name,
				volumeId: getRequiredId(volumeIds, schedule.volumeRef, "volume"),
				repositoryId: getRequiredId(repositoryIds, schedule.repositoryRef, "repository"),
				enabled: schedule.enabled,
				cronExpression: schedule.cronExpression,
				retentionPolicy: schedule.retentionPolicy,
				excludePatterns: schedule.excludePatterns,
				excludeIfPresent: schedule.excludeIfPresent,
				includePaths: schedule.includePaths,
				includePatterns: schedule.includePatterns,
				nextBackupAt,
				oneFileSystem: schedule.oneFileSystem,
				customResticParams: schedule.customResticParams,
				compressionMode: schedule.compressionMode,
				backupWebhooks: schedule.backupWebhooks,
				sortOrder: schedule.sortOrder,
				maxRetries: schedule.maxRetries,
				retryDelay: schedule.retryDelay,
				organizationId,
			})
			.returning({ id: backupSchedulesTable.id })
			.get();

		if (!inserted) {
			throw new Error(`Failed to import backup schedule ${schedule.ref}`);
		}
		ids.set(schedule.ref, inserted.id);
	}

	return ids;
};

const importDestinations = (
	tx: Transaction,
	organizationId: string,
	destinations: PreparedImport["notificationDestinations"],
) => {
	const ids = new Map<string, number>();

	for (const destination of destinations) {
		const inserted = tx
			.insert(notificationDestinationsTable)
			.values({
				name: destination.name,
				enabled: destination.enabled,
				type: destination.config.type,
				config: destination.config,
				organizationId,
			})
			.returning({ id: notificationDestinationsTable.id })
			.get();

		if (!inserted) {
			throw new Error(`Failed to import notification destination ${destination.ref}`);
		}
		ids.set(destination.ref, inserted.id);
	}

	return ids;
};

export const storeImport = (organizationId: string, userId: string, prepared: PreparedImport) => {
	db.transaction((tx) => {
		assertAllowed(tx, organizationId, userId);
		const org = tx.query.organization
			.findFirst({ where: { id: organizationId }, columns: { metadata: true } })
			.sync();

		if (!org) {
			throw new Error("Organization not found");
		}

		const repositoryIds = importRepositories(tx, organizationId, prepared.repositories);
		const volumeIds = importVolumes(tx, organizationId, prepared.volumes);
		const scheduleIds = importSchedules(tx, organizationId, prepared.backupSchedules, volumeIds, repositoryIds);
		const destinationIds = importDestinations(tx, organizationId, prepared.notificationDestinations);

		for (const mirror of prepared.backupScheduleMirrors) {
			tx.insert(backupScheduleMirrorsTable)
				.values({
					scheduleId: getRequiredId(scheduleIds, mirror.scheduleRef, "backup schedule"),
					repositoryId: getRequiredId(repositoryIds, mirror.repositoryRef, "repository"),
					enabled: mirror.enabled,
				})
				.run();
		}

		for (const notification of prepared.backupScheduleNotifications) {
			tx.insert(backupScheduleNotificationsTable)
				.values({
					scheduleId: getRequiredId(scheduleIds, notification.scheduleRef, "backup schedule"),
					destinationId: getRequiredId(
						destinationIds,
						notification.destinationRef,
						"notification destination",
					),
					notifyOnStart: notification.notifyOnStart,
					notifyOnSuccess: notification.notifyOnSuccess,
					notifyOnWarning: notification.notifyOnWarning,
					notifyOnFailure: notification.notifyOnFailure,
				})
				.run();
		}

		const metadata = { ...org.metadata, resticPassword: prepared.sealedResticPassword };
		const recoveryKeyExportedAt = new Date();
		tx.update(organization)
			.set({ metadata, recoveryKeyExportedAt })
			.where(eq(organization.id, organizationId))
			.run();
		tx.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId)).run();
	});

	return {
		repositories: prepared.repositories.length,
		volumes: prepared.volumes.length,
		backupSchedules: prepared.backupSchedules.length,
		notificationDestinations: prepared.notificationDestinations.length,
		backupScheduleMirrors: prepared.backupScheduleMirrors.length,
		backupScheduleNotifications: prepared.backupScheduleNotifications.length,
	};
};
