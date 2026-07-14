export const BACKUP_SCHEDULE_NAME_MAX_LENGTH = 128;

export const isValidBackupScheduleName = (name: string) => {
	return name.length > 0 && name.length <= BACKUP_SCHEDULE_NAME_MAX_LENGTH;
};
