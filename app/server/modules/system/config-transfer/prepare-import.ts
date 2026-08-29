import { validateCustomResticParams } from "@zerobyte/core/restic/server";
import { config as serverConfig } from "~/server/core/config";
import { validateScheduleTiming } from "~/server/modules/backups/backup.helpers";
import { isValidBackupScheduleName } from "~/server/modules/backups/backup-schedule-name";
import { encryptNotificationConfig } from "~/server/modules/notifications/notification-config-secrets";
import { assertNotificationTargetAllowed } from "~/server/modules/notifications/utils/notification-target-policy";
import { encryptRepositoryConfig } from "~/server/modules/repositories/repository-config-secrets";
import { encryptVolumeConfig } from "~/server/modules/volumes/volume-config-secrets";
import { checkMirrorCompatibility } from "~/server/utils/backend-compatibility";
import { cryptoUtils } from "~/server/utils/crypto";
import { normalizeRequiredName } from "~/server/utils/names";
import type { SystemInfoDto } from "../system.dto";
import { systemService } from "../system.service";
import { InvalidConfigTransferError } from "./errors";
import type { ConfigTransferModel } from "./model";

export type PreparedImport = Omit<ConfigTransferModel, "resticPassword"> & {
	sealedResticPassword: string;
};

const validateSchedules = (schedules: ConfigTransferModel["backupSchedules"]) => {
	const scheduleNames = new Set<string>();
	const scheduleShortIds = new Set<string>();

	for (const schedule of schedules) {
		if (
			!isValidBackupScheduleName(schedule.name) ||
			scheduleNames.has(schedule.name) ||
			scheduleShortIds.has(schedule.shortId)
		) {
			throw new InvalidConfigTransferError();
		}
		scheduleNames.add(schedule.name);
		scheduleShortIds.add(schedule.shortId);

		const error = validateScheduleTiming(schedule);
		if (error) {
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

const normalizeNames = <Resource extends { name: string }>(resources: Resource[]) => {
	return resources.map((resource) => {
		const name = normalizeRequiredName(resource.name);
		if (name === null) {
			throw new InvalidConfigTransferError();
		}

		return { ...resource, name };
	});
};

const validateUniqueVolumeNames = (volumes: ConfigTransferModel["volumes"]) => {
	const volumeNames = new Set(volumes.map((volume) => volume.name));
	if (volumeNames.size !== volumes.length) {
		throw new InvalidConfigTransferError();
	}
};

const normalizeImportedNames = (payload: ConfigTransferModel): ConfigTransferModel => {
	const repositories = normalizeNames(payload.repositories);
	const volumes = normalizeNames(payload.volumes);
	const notificationDestinations = normalizeNames(payload.notificationDestinations);
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

const createWarnings = (payload: ConfigTransferModel, capabilities: SystemInfoDto["capabilities"]) => {
	const warnings: string[] = [];
	const volumeRequirements = new Map<string, string>();
	const repositoryRequirements = new Map<string, string>();
	const mirrorRequirements = new Map<string, Set<string>>();
	const volumeBackends = new Set(capabilities.volumeBackends);
	const repositoryBackends = new Set(capabilities.repositoryBackends);

	for (const volume of payload.volumes) {
		volumeRequirements.set(volume.ref, `volume "${volume.name}"`);

		if (volume.config.backend === "directory") {
			warnings.push(
				`Volume "${volume.name}" uses local directory path "${volume.config.path}". Verify and mount this path on this server before using it.`,
			);
		} else if (!volumeBackends.has(volume.config.backend)) {
			warnings.push(
				`Volume "${volume.name}" uses the "${volume.config.backend}" backend, which is unavailable on this server. Enable that backend and mount the volume before using it.`,
			);
		} else {
			warnings.push(`Volume "${volume.name}" was imported unmounted. Mount it on this server before using it.`);
		}
	}

	for (const repository of payload.repositories) {
		if (repository.config.backend === "local") {
			repositoryRequirements.set(repository.ref, `repository "${repository.name}"`);
			warnings.push(
				`Repository "${repository.name}" uses local path "${repository.config.path}". Verify that this repository exists on this server before using it.`,
			);
		} else if (!repositoryBackends.has(repository.config.backend)) {
			repositoryRequirements.set(repository.ref, `repository "${repository.name}"`);
			warnings.push(
				`Repository "${repository.name}" uses the "${repository.config.backend}" backend, which is unavailable on this server. Enable that backend before using it.`,
			);
		}
	}

	for (const mirror of payload.backupScheduleMirrors) {
		const requirement = repositoryRequirements.get(mirror.repositoryRef);
		if (!requirement) {
			continue;
		}

		const requirements = mirrorRequirements.get(mirror.scheduleRef) ?? new Set<string>();
		requirements.add(requirement);
		mirrorRequirements.set(mirror.scheduleRef, requirements);
	}

	const schedulesRequiringReview = new Set<string>();

	for (const schedule of payload.backupSchedules) {
		const requirements = new Set<string>();
		const volumeRequirement = volumeRequirements.get(schedule.volumeRef);
		const repositoryRequirement = repositoryRequirements.get(schedule.repositoryRef);

		if (volumeRequirement) {
			requirements.add(volumeRequirement);
		}
		if (repositoryRequirement) {
			requirements.add(repositoryRequirement);
		}
		for (const mirrorRequirement of mirrorRequirements.get(schedule.ref) ?? []) {
			requirements.add(mirrorRequirement);
		}

		if (requirements.size > 0) {
			schedulesRequiringReview.add(schedule.ref);
			if (schedule.enabled) {
				const requirementList = new Intl.ListFormat("en", { type: "conjunction" }).format(requirements);
				warnings.push(
					`Disabled schedule "${schedule.name}" because it references ${requirementList}. Re-enable it after reviewing those imported resources on this server.`,
				);
			}
		}
	}

	return { schedulesRequiringReview, warnings };
};

export const prepareImport = async (
	payload: ConfigTransferModel,
): Promise<{ prepared: PreparedImport; warnings: string[] }> => {
	const normalizedPayload = normalizeImportedNames(payload);
	validateSchedules(normalizedPayload.backupSchedules);
	await validateMirrors(normalizedPayload);
	const systemInfo = await systemService.getSystemInfo();

	try {
		for (const destination of normalizedPayload.notificationDestinations) {
			assertNotificationTargetAllowed(destination.config, serverConfig.webhookAllowedOrigins);
		}
	} catch {
		throw new InvalidConfigTransferError();
	}

	let repositories: PreparedImport["repositories"];
	let volumes: PreparedImport["volumes"];
	let notificationDestinations: PreparedImport["notificationDestinations"];
	let sealedResticPassword: string;
	try {
		[repositories, volumes, notificationDestinations, sealedResticPassword] = await Promise.all([
			Promise.all(
				normalizedPayload.repositories.map(async (repository) => ({
					...repository,
					config: await encryptRepositoryConfig(repository.config),
				})),
			),
			Promise.all(
				normalizedPayload.volumes.map(async (volume) => ({
					...volume,
					config: await encryptVolumeConfig(volume.config),
				})),
			),
			Promise.all(
				normalizedPayload.notificationDestinations.map(async (destination) => ({
					...destination,
					config: await encryptNotificationConfig(destination.config),
				})),
			),
			cryptoUtils.sealSecret(normalizedPayload.resticPassword),
		]);
	} catch {
		throw new InvalidConfigTransferError();
	}

	const { schedulesRequiringReview, warnings } = createWarnings(normalizedPayload, systemInfo.capabilities);
	const backupSchedules = normalizedPayload.backupSchedules.map((schedule) => {
		const enabled = schedule.enabled && !schedulesRequiringReview.has(schedule.ref);

		return { ...schedule, enabled };
	});
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
