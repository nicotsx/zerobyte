import type { Repository, Volume } from "~/server/db/schema";
import { presentVolumes } from "../volumes/volume-presentation";

type ScheduleWithRelations = {
	volume: Volume;
	repository: Repository;
};

export const presentBackupSchedules = async <TSchedule extends ScheduleWithRelations>(
	schedules: TSchedule[],
	organizationId: string,
) => {
	const volumes = schedules.map((schedule) => schedule.volume);
	const presented = await presentVolumes(volumes, organizationId);
	return schedules.map((schedule, index) => {
		const volume = presented[index];
		if (!volume) throw new Error("Backup source presentation failed");
		return { ...schedule, volume };
	});
};

export const presentBackupSchedule = async <TSchedule extends ScheduleWithRelations>(
	schedule: TSchedule,
	organizationId: string,
) => {
	const schedules = await presentBackupSchedules([schedule], organizationId);
	const presentedSchedule = schedules[0];
	if (!presentedSchedule) {
		throw new Error("Failed to present backup schedule");
	}
	return presentedSchedule;
};
