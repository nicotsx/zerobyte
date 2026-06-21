import { eq } from "drizzle-orm";
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
import {
	parseConfigTransferPayload,
	parseCurrentConfigTransferPayload,
} from "~/server/modules/system/config-transfer/payload";
import { mapNotificationConfigSecrets } from "~/server/modules/notifications/notification-config-secrets";
import { mapRepositoryConfigSecrets } from "~/server/modules/repositories/repository-config-secrets";
import { mapVolumeConfigSecrets } from "~/server/modules/volumes/volume-config-secrets";
import { cryptoUtils } from "~/server/utils/crypto";
import { generateShortId } from "~/server/utils/id";

const configTransferPrefix = "zbcfg:";

const createTransferRef = (prefix: string, index: number) => `${prefix}:${index + 1}`;

const pushUnique = (items: string[], value: string) => {
	if (!items.includes(value)) {
		items.push(value);
	}
};

const joinWithAnd = (items: string[]) => {
	if (items.length <= 1) {
		return items[0] ?? "";
	}

	if (items.length === 2) {
		return `${items[0]} and ${items[1]}`;
	}

	return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
};

const decodeEncryptedPayload = async (encryptedConfig: string, sourceAppSecret: string) => {
	const decryptedPayload = await cryptoUtils.decryptWithSecret(encryptedConfig, {
		prefix: configTransferPrefix,
		secret: sourceAppSecret,
	});
	const parsed = JSON.parse(decryptedPayload) as unknown;

	return parseConfigTransferPayload(parsed);
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

export const createEncryptedOrganizationConfigExport = async (
	organizationId: string,
	sourceAppSecret: string,
	resticPassword: string,
) => {
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

	const repositoryRefMap = new Map<string, string>();
	const volumeRefMap = new Map<number, string>();
	const scheduleRefMap = new Map<number, string>();
	const destinationRefMap = new Map<number, string>();

	const exportedRepositories = repositories.map((repository, index) => {
		const ref = createTransferRef("repository", index);
		repositoryRefMap.set(repository.id, ref);

		return {
			ref,
			name: repository.name,
			config: repository.config,
			compressionMode: repository.compressionMode ?? "auto",
			uploadLimit: {
				enabled: repository.uploadLimitEnabled,
				value: repository.uploadLimitValue,
				unit: repository.uploadLimitUnit,
			},
			downloadLimit: {
				enabled: repository.downloadLimitEnabled,
				value: repository.downloadLimitValue,
				unit: repository.downloadLimitUnit,
			},
		};
	});

	const exportedVolumes = volumes.map((volume, index) => {
		const ref = createTransferRef("volume", index);
		volumeRefMap.set(volume.id, ref);

		return {
			ref,
			name: volume.name,
			config: volume.config,
			autoRemount: volume.autoRemount,
		};
	});

	const exportedSchedules = backupSchedules.map((schedule, index) => {
		const volumeRef = volumeRefMap.get(schedule.volumeId);
		const repositoryRef = repositoryRefMap.get(schedule.repositoryId);

		if (!volumeRef) {
			throw new Error(`Exported volume ${schedule.volumeId} not found`);
		}

		if (!repositoryRef) {
			throw new Error(`Exported repository ${schedule.repositoryId} not found`);
		}

		const ref = createTransferRef("schedule", index);
		scheduleRefMap.set(schedule.id, ref);

		return {
			ref,
			name: schedule.name,
			volumeRef,
			repositoryRef,
			enabled: schedule.enabled,
			cronExpression: schedule.cronExpression,
			retentionPolicy: schedule.retentionPolicy ?? null,
			excludePatterns: schedule.excludePatterns ?? [],
			excludeIfPresent: schedule.excludeIfPresent ?? [],
			includePaths: schedule.includePaths ?? [],
			includePatterns: schedule.includePatterns ?? [],
			oneFileSystem: schedule.oneFileSystem,
			customResticParams: schedule.customResticParams ?? [],
			backupWebhooks: schedule.backupWebhooks ?? null,
			maxRetries: schedule.maxRetries,
			retryDelay: schedule.retryDelay,
			sortOrder: schedule.sortOrder,
		};
	});

	const exportedDestinations = notificationDestinations.map((destination, index) => {
		const ref = createTransferRef("destination", index);
		destinationRefMap.set(destination.id, ref);

		return {
			ref,
			name: destination.name,
			enabled: destination.enabled,
			config: destination.config,
		};
	});

	const exportedMirrors = backupScheduleMirrors.map((mirror) => {
		const scheduleRef = scheduleRefMap.get(mirror.scheduleId);
		const repositoryRef = repositoryRefMap.get(mirror.repositoryId);

		if (!scheduleRef) {
			throw new Error(`Exported backup schedule ${mirror.scheduleId} not found`);
		}

		if (!repositoryRef) {
			throw new Error(`Exported repository ${mirror.repositoryId} not found`);
		}

		return {
			scheduleRef,
			repositoryRef,
			enabled: mirror.enabled,
		};
	});

	const exportedNotifications = backupScheduleNotifications.map((notification) => {
		const scheduleRef = scheduleRefMap.get(notification.scheduleId);
		const destinationRef = destinationRefMap.get(notification.destinationId);

		if (!scheduleRef) {
			throw new Error(`Exported backup schedule ${notification.scheduleId} not found`);
		}

		if (!destinationRef) {
			throw new Error(`Exported notification destination ${notification.destinationId} not found`);
		}

		return {
			scheduleRef,
			destinationRef,
			notifyOnStart: notification.notifyOnStart,
			notifyOnSuccess: notification.notifyOnSuccess,
			notifyOnWarning: notification.notifyOnWarning,
			notifyOnFailure: notification.notifyOnFailure,
		};
	});

	const payload = parseCurrentConfigTransferPayload({
		version: 1,
		resticPassword,
		repositories: exportedRepositories,
		volumes: exportedVolumes,
		backupSchedules: exportedSchedules,
		notificationDestinations: exportedDestinations,
		backupScheduleMirrors: exportedMirrors,
		backupScheduleNotifications: exportedNotifications,
	});

	return await cryptoUtils.encryptWithSecret(JSON.stringify(payload), {
		prefix: configTransferPrefix,
		secret: sourceAppSecret,
	});
};

export const importEncryptedOrganizationConfig = async (
	organizationId: string,
	userId: string,
	encryptedConfig: string,
	sourceAppSecret: string,
) => {
	const parsedPayload = await decodeEncryptedPayload(encryptedConfig, sourceAppSecret);
	const warnings: string[] = [];
	const volumeValidationRequirements = new Map<string, string>();
	const repositoryValidationRequirements = new Map<string, string>();
	const mirrorValidationRequirementsByScheduleRef = new Map<string, string[]>();
	const resealImportedSecret = async (value: string) => {
		const plaintext = await cryptoUtils.resolveSecretWithSecret(value, sourceAppSecret);

		return await cryptoUtils.sealSecret(plaintext);
	};

	for (const volume of parsedPayload.volumes) {
		if (volume.config.backend !== "directory") {
			continue;
		}

		volumeValidationRequirements.set(volume.ref, `volume "${volume.name}"`);
		pushUnique(
			warnings,
			`Volume "${volume.name}" uses local directory path "${volume.config.path}". Verify this path on this server before using it.`,
		);
	}

	for (const repository of parsedPayload.repositories) {
		if (repository.config.backend !== "local") {
			continue;
		}

		repositoryValidationRequirements.set(repository.ref, `repository "${repository.name}"`);
		pushUnique(
			warnings,
			`Repository "${repository.name}" uses local path "${repository.config.path}". Verify that this repository exists on this server before using it.`,
		);
	}

	for (const mirror of parsedPayload.backupScheduleMirrors) {
		const repositoryRequirement = repositoryValidationRequirements.get(mirror.repositoryRef);

		if (!repositoryRequirement) {
			continue;
		}

		const currentRequirements = mirrorValidationRequirementsByScheduleRef.get(mirror.scheduleRef) ?? [];
		pushUnique(currentRequirements, repositoryRequirement);
		mirrorValidationRequirementsByScheduleRef.set(mirror.scheduleRef, currentRequirements);
	}

	const [encryptedRepositories, encryptedVolumes, encryptedNotificationDestinations] = await Promise.all([
		Promise.all(
			parsedPayload.repositories.map(async (repository) => ({
				...repository,
				config: await mapRepositoryConfigSecrets(repository.config, resealImportedSecret),
			})),
		),
		Promise.all(
			parsedPayload.volumes.map(async (volume) => ({
				...volume,
				config: await mapVolumeConfigSecrets(volume.config, resealImportedSecret),
			})),
		),
		Promise.all(
			parsedPayload.notificationDestinations.map(async (destination) => ({
				...destination,
				config: await mapNotificationConfigSecrets(destination.config, resealImportedSecret),
			})),
		),
	]);

	const sealedResticPassword = await cryptoUtils.sealSecret(parsedPayload.resticPassword);

	db.transaction((tx) => {
		const org = tx.query.organization.findFirst({ where: { id: organizationId }, columns: { metadata: true } }).sync();
		const repositoryIdMap = new Map<string, string>();
		const volumeIdMap = new Map<string, number>();
		const scheduleIdMap = new Map<string, number>();
		const destinationIdMap = new Map<string, number>();

		if (!org) {
			throw new Error("Organization not found");
		}

		for (const repository of encryptedRepositories) {
			const importedRepositoryId = Bun.randomUUIDv7();

			tx.insert(repositoriesTable)
				.values({
					id: importedRepositoryId,
					shortId: generateShortId(),
					name: repository.name,
					type: repository.config.backend,
					config: repository.config,
					compressionMode: repository.compressionMode,
					status: "unknown",
					lastChecked: null,
					lastError: null,
					doctorResult: null,
					stats: null,
					statsUpdatedAt: null,
					uploadLimitEnabled: repository.uploadLimit.enabled,
					uploadLimitValue: repository.uploadLimit.value,
					uploadLimitUnit: repository.uploadLimit.unit,
					downloadLimitEnabled: repository.downloadLimit.enabled,
					downloadLimitValue: repository.downloadLimit.value,
					downloadLimitUnit: repository.downloadLimit.unit,
					organizationId,
				})
				.run();

			repositoryIdMap.set(repository.ref, importedRepositoryId);
		}

		for (const volume of encryptedVolumes) {
			const importedVolumeShortId = generateShortId();

			tx.insert(volumesTable)
				.values({
					shortId: importedVolumeShortId,
					name: volume.name,
					type: volume.config.backend,
					status: "unmounted",
					lastError: null,
					config: volume.config,
					autoRemount: volume.autoRemount,
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
				throw new Error(`Imported volume ${volume.ref} not found`);
			}

			volumeIdMap.set(volume.ref, insertedVolume.id);
		}

		for (const schedule of parsedPayload.backupSchedules) {
			const mappedVolumeId = volumeIdMap.get(schedule.volumeRef);
			const mappedRepositoryId = repositoryIdMap.get(schedule.repositoryRef);
			const validationRequirements = new Set<string>();

			if (!mappedVolumeId) {
				throw new Error(`Imported volume ${schedule.volumeRef} not found`);
			}

			if (!mappedRepositoryId) {
				throw new Error(`Imported repository ${schedule.repositoryRef} not found`);
			}

			const volumeValidationRequirement = volumeValidationRequirements.get(schedule.volumeRef);
			if (volumeValidationRequirement) {
				validationRequirements.add(volumeValidationRequirement);
			}

			const repositoryValidationRequirement = repositoryValidationRequirements.get(schedule.repositoryRef);
			if (repositoryValidationRequirement) {
				validationRequirements.add(repositoryValidationRequirement);
			}

			for (const mirrorValidationRequirement of mirrorValidationRequirementsByScheduleRef.get(schedule.ref) ?? []) {
				validationRequirements.add(mirrorValidationRequirement);
			}

			const shouldDisableForValidation = validationRequirements.size > 0;

			const importedScheduleShortId = generateShortId();

			tx.insert(backupSchedulesTable)
				.values({
					shortId: importedScheduleShortId,
					name: schedule.name,
					volumeId: mappedVolumeId,
					repositoryId: mappedRepositoryId,
					enabled: shouldDisableForValidation ? false : schedule.enabled,
					cronExpression: schedule.cronExpression,
					retentionPolicy: schedule.retentionPolicy,
					excludePatterns: schedule.excludePatterns,
					excludeIfPresent: schedule.excludeIfPresent,
					includePaths: schedule.includePaths,
					includePatterns: schedule.includePatterns,
					lastBackupAt: null,
					lastBackupStatus: null,
					lastBackupError: null,
					nextBackupAt: schedule.cronExpression ? calculateNextRun(schedule.cronExpression) : null,
					oneFileSystem: schedule.oneFileSystem,
					customResticParams: schedule.customResticParams,
					backupWebhooks: schedule.backupWebhooks,
					sortOrder: schedule.sortOrder,
					failureRetryCount: 0,
					maxRetries: schedule.maxRetries,
					retryDelay: schedule.retryDelay,
					organizationId,
				})
				.run();

			if (shouldDisableForValidation && schedule.enabled) {
				pushUnique(
					warnings,
					`Disabled schedule "${schedule.name}" because it references ${joinWithAnd([...validationRequirements])}. Re-enable it after validating those imported paths on this server.`,
				);
			}

			const insertedSchedule = tx.query.backupSchedulesTable
				.findFirst({
					where: {
						AND: [{ shortId: { eq: importedScheduleShortId } }, { organizationId }],
					},
					columns: { id: true },
				})
				.sync();

			if (!insertedSchedule) {
				throw new Error(`Imported backup schedule ${schedule.ref} not found`);
			}

			scheduleIdMap.set(schedule.ref, insertedSchedule.id);
		}

		for (const destination of encryptedNotificationDestinations) {
			tx.insert(notificationDestinationsTable)
				.values({
					name: destination.name,
					enabled: destination.enabled,
					type: destination.config.type,
					config: destination.config,
					organizationId,
				})
				.run();

			const insertedDestination = tx.query.notificationDestinationsTable
				.findFirst({
					where: { organizationId },
					orderBy: { id: "desc" },
					columns: { id: true },
				})
				.sync();

			if (!insertedDestination) {
				throw new Error(`Imported notification destination ${destination.ref} not found`);
			}

			destinationIdMap.set(destination.ref, insertedDestination.id);
		}

		for (const mirror of parsedPayload.backupScheduleMirrors) {
			const mappedScheduleId = scheduleIdMap.get(mirror.scheduleRef);
			const mappedRepositoryId = repositoryIdMap.get(mirror.repositoryRef);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${mirror.scheduleRef} not found`);
			}

			if (!mappedRepositoryId) {
				throw new Error(`Imported repository ${mirror.repositoryRef} not found`);
			}

			tx.insert(backupScheduleMirrorsTable)
				.values({
					scheduleId: mappedScheduleId,
					repositoryId: mappedRepositoryId,
					enabled: mirror.enabled,
					lastCopyAt: null,
					lastCopyStatus: null,
					lastCopyError: null,
				})
				.run();
		}

		for (const notification of parsedPayload.backupScheduleNotifications) {
			const mappedScheduleId = scheduleIdMap.get(notification.scheduleRef);
			const mappedDestinationId = destinationIdMap.get(notification.destinationRef);

			if (!mappedScheduleId) {
				throw new Error(`Imported backup schedule ${notification.scheduleRef} not found`);
			}

			if (!mappedDestinationId) {
				throw new Error(`Imported notification destination ${notification.destinationRef} not found`);
			}

			tx.insert(backupScheduleNotificationsTable)
				.values({
					scheduleId: mappedScheduleId,
					destinationId: mappedDestinationId,
					notifyOnStart: notification.notifyOnStart,
					notifyOnSuccess: notification.notifyOnSuccess,
					notifyOnWarning: notification.notifyOnWarning,
					notifyOnFailure: notification.notifyOnFailure,
				})
				.run();
		}

		tx.update(organization)
			.set({ metadata: { ...org.metadata, resticPassword: sealedResticPassword } })
			.where(eq(organization.id, organizationId))
			.run();

		tx.update(usersTable).set({ hasDownloadedResticPassword: true }).where(eq(usersTable.id, userId)).run();
	});

	return {
		imported: {
			repositories: parsedPayload.repositories.length,
			volumes: parsedPayload.volumes.length,
			backupSchedules: parsedPayload.backupSchedules.length,
			notificationDestinations: parsedPayload.notificationDestinations.length,
			backupScheduleMirrors: parsedPayload.backupScheduleMirrors.length,
			backupScheduleNotifications: parsedPayload.backupScheduleNotifications.length,
		},
		warnings,
	};
};
