import { validateCustomResticParams } from "@zerobyte/core/restic/server";
import { config as serverConfig } from "~/server/core/config";
import { isValidCron } from "~/server/modules/backups/backup.helpers";
import { isValidBackupScheduleName } from "~/server/modules/backups/backup-schedule-name";
import { mapNotificationConfigSecrets } from "~/server/modules/notifications/notification-config-secrets";
import { assertNotificationTargetAllowed } from "~/server/modules/notifications/utils/notification-target-policy";
import { mapRepositoryConfigSecrets } from "~/server/modules/repositories/repository-config-secrets";
import { mapVolumeConfigSecrets } from "~/server/modules/volumes/volume-config-secrets";
import { checkMirrorCompatibility } from "~/server/utils/backend-compatibility";
import { cryptoUtils } from "~/server/utils/crypto";
import { normalizeRequiredName } from "~/server/utils/names";
import { InvalidConfigTransferError } from "./errors";
import type { ConfigTransferModel } from "./model";

export type PreparedConfigImport = Omit<ConfigTransferModel, "resticPassword"> & {
	sealedResticPassword: string;
};

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

const validateSchedules = (schedules: ConfigTransferModel["backupSchedules"]) => {
	const scheduleNames = new Set<string>();

	for (const schedule of schedules) {
		if (!isValidBackupScheduleName(schedule.name) || scheduleNames.has(schedule.name)) {
			throw new InvalidConfigTransferError();
		}
		scheduleNames.add(schedule.name);

		if (schedule.cronExpression && !isValidCron(schedule.cronExpression)) {
			throw new InvalidConfigTransferError();
		}

		if (schedule.enabled && !schedule.cronExpression) {
			throw new InvalidConfigTransferError();
		}

		if (schedule.customResticParams.length > 0) {
			const paramError = validateCustomResticParams(schedule.customResticParams);
			if (paramError) {
				throw new InvalidConfigTransferError();
			}
		}
	}
};

const normalizeImportedResourceNames = <Resource extends { name: string }>(resources: Resource[]) => {
	return resources.map((resource) => {
		const name = normalizeRequiredName(resource.name);
		if (name === null) {
			throw new InvalidConfigTransferError();
		}

		return { ...resource, name };
	});
};

const validateUniqueVolumeNames = (volumes: ConfigTransferModel["volumes"]) => {
	const volumeNames = new Set<string>();

	for (const volume of volumes) {
		if (volumeNames.has(volume.name)) {
			throw new InvalidConfigTransferError();
		}

		volumeNames.add(volume.name);
	}
};

const normalizeImportedNames = (payload: ConfigTransferModel): ConfigTransferModel => {
	const repositories = normalizeImportedResourceNames(payload.repositories);
	const volumes = normalizeImportedResourceNames(payload.volumes);
	const notificationDestinations = normalizeImportedResourceNames(payload.notificationDestinations);
	validateUniqueVolumeNames(volumes);

	return { ...payload, repositories, volumes, notificationDestinations };
};

const validateMirrors = async (payload: ConfigTransferModel) => {
	const repositoriesByRef = new Map(payload.repositories.map((repository) => [repository.ref, repository]));
	const schedulesByRef = new Map(payload.backupSchedules.map((schedule) => [schedule.ref, schedule]));

	for (const mirror of payload.backupScheduleMirrors) {
		const schedule = schedulesByRef.get(mirror.scheduleRef);
		if (!schedule) {
			throw new InvalidConfigTransferError();
		}

		const primaryRepository = repositoriesByRef.get(schedule.repositoryRef);
		const mirrorRepository = repositoriesByRef.get(mirror.repositoryRef);

		if (!primaryRepository || !mirrorRepository) {
			throw new InvalidConfigTransferError();
		}

		if (schedule.repositoryRef === mirror.repositoryRef) {
			throw new InvalidConfigTransferError();
		}

		const compatibility = await checkMirrorCompatibility(
			primaryRepository.config,
			mirrorRepository.config,
			mirror.repositoryRef,
		);

		if (!compatibility.compatible) {
			throw new InvalidConfigTransferError();
		}
	}
};

const createLocalPathWarnings = (payload: ConfigTransferModel) => {
	const warnings: string[] = [];
	const volumeRequirements = new Map<string, string>();
	const repositoryRequirements = new Map<string, string>();
	const mirrorRequirementsBySchedule = new Map<string, string[]>();

	for (const volume of payload.volumes) {
		if (volume.config.backend === "directory") {
			volumeRequirements.set(volume.ref, `volume "${volume.name}"`);
			warnings.push(
				`Volume "${volume.name}" uses local directory path "${volume.config.path}". Verify this path on this server before using it.`,
			);
		}
	}

	for (const repository of payload.repositories) {
		if (repository.config.backend === "local") {
			repositoryRequirements.set(repository.ref, `repository "${repository.name}"`);
			warnings.push(
				`Repository "${repository.name}" uses local path "${repository.config.path}". Verify that this repository exists on this server before using it.`,
			);
		}
	}

	for (const mirror of payload.backupScheduleMirrors) {
		const requirement = repositoryRequirements.get(mirror.repositoryRef);
		if (!requirement) {
			continue;
		}

		const requirements = mirrorRequirementsBySchedule.get(mirror.scheduleRef) ?? [];
		pushUnique(requirements, requirement);
		mirrorRequirementsBySchedule.set(mirror.scheduleRef, requirements);
	}

	const requirementsBySchedule = new Map<string, string[]>();

	for (const schedule of payload.backupSchedules) {
		const requirements: string[] = [];
		const volumeRequirement = volumeRequirements.get(schedule.volumeRef);
		const repositoryRequirement = repositoryRequirements.get(schedule.repositoryRef);

		if (volumeRequirement) {
			requirements.push(volumeRequirement);
		}
		if (repositoryRequirement) {
			requirements.push(repositoryRequirement);
		}
		for (const mirrorRequirement of mirrorRequirementsBySchedule.get(schedule.ref) ?? []) {
			pushUnique(requirements, mirrorRequirement);
		}

		if (requirements.length > 0) {
			requirementsBySchedule.set(schedule.ref, requirements);
			if (schedule.enabled) {
				warnings.push(
					`Disabled schedule "${schedule.name}" because it references ${joinWithAnd(requirements)}. Re-enable it after validating those imported paths on this server.`,
				);
			}
		}
	}

	return { requirementsBySchedule, warnings };
};

export const prepareConfigImport = async (
	payload: ConfigTransferModel,
): Promise<{ prepared: PreparedConfigImport; warnings: string[] }> => {
	const normalizedPayload = normalizeImportedNames(payload);
	validateSchedules(normalizedPayload.backupSchedules);
	await validateMirrors(normalizedPayload);

	try {
		for (const destination of normalizedPayload.notificationDestinations) {
			assertNotificationTargetAllowed(destination.config, serverConfig.webhookAllowedOrigins);
		}
	} catch {
		throw new InvalidConfigTransferError();
	}

	const sealImportedSecret = async (value: string) => {
		try {
			return await cryptoUtils.sealSecret(value);
		} catch {
			throw new InvalidConfigTransferError();
		}
	};
	const sealImportedResticPassword = async () => {
		try {
			return await cryptoUtils.sealSecret(normalizedPayload.resticPassword);
		} catch {
			throw new InvalidConfigTransferError();
		}
	};

	const [repositories, volumes, notificationDestinations, sealedResticPassword] = await Promise.all([
		Promise.all(
			normalizedPayload.repositories.map(async (repository) => ({
				...repository,
				config: await mapRepositoryConfigSecrets(repository.config, sealImportedSecret),
			})),
		),
		Promise.all(
			normalizedPayload.volumes.map(async (volume) => ({
				...volume,
				config: await mapVolumeConfigSecrets(volume.config, sealImportedSecret),
			})),
		),
		Promise.all(
			normalizedPayload.notificationDestinations.map(async (destination) => ({
				...destination,
				config: await mapNotificationConfigSecrets(destination.config, sealImportedSecret),
			})),
		),
		sealImportedResticPassword(),
	]);

	const { requirementsBySchedule, warnings } = createLocalPathWarnings(normalizedPayload);
	const backupSchedules = normalizedPayload.backupSchedules.map((schedule) => ({
		...schedule,
		enabled: requirementsBySchedule.has(schedule.ref) ? false : schedule.enabled,
	}));
	const { resticPassword: _resticPassword, ...config } = normalizedPayload;

	return {
		prepared: {
			...config,
			repositories,
			volumes,
			backupSchedules,
			notificationDestinations,
			sealedResticPassword,
		},
		warnings,
	};
};
