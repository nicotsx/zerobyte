import type { BackupSchedule, Repository, VolumeRow } from "~/server/db/schema";
import { presentRepository } from "../repositories/repository-presentation";
import { presentVolumes } from "../volumes/volume-presentation";

export type BackupScheduleWithResources = BackupSchedule & {
	volume: VolumeRow;
	repository: Repository;
};

export const presentBackupSchedules = async (schedules: readonly BackupScheduleWithResources[]) => {
	const volumes = await presentVolumes(schedules.map((schedule) => schedule.volume));

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
			repository: presentRepository(schedule.repository),
		};
	});
};

export const presentBackupSchedule = async (schedule: BackupScheduleWithResources) => {
	return (await presentBackupSchedules([schedule]))[0];
};
