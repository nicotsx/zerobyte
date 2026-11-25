import type { BackupSchedule, Repository, VolumeRow } from "~/server/db/schema";
import { presentRepositories } from "../repositories/repository-presentation";
import { presentVolumes } from "../volumes/volume-presentation";

export type BackupScheduleWithResources = BackupSchedule & {
	volume: VolumeRow;
	repository: Repository;
};

export const presentBackupSchedules = async (schedules: readonly BackupScheduleWithResources[]) => {
	const volumes = await presentVolumes(schedules.map((schedule) => schedule.volume));
	const repositories = await presentRepositories(schedules.map((schedule) => schedule.repository));

	return schedules.map((schedule, index) => {
		const {
			organizationId: _organizationId,
			volume: _volume,
			repository: _repository,
			...publicSchedule
		} = schedule;

		return {
			...publicSchedule,
			volume: volumes[index],
			repository: repositories[index],
		};
	});
};

export const presentBackupSchedule = async (schedule: BackupScheduleWithResources) => {
	return (await presentBackupSchedules([schedule]))[0];
};
