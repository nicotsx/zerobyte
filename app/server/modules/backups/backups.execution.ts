import { backupsService } from "./backups.service";

export const backupsExecutionService = {
	executeBackup: backupsService.executeBackup,
	validateBackupExecution: backupsService.validateBackupExecution,
	getSchedulesToExecute: backupsService.getSchedulesToExecute,
	stopBackup: backupsService.stopBackup,
	runForget: backupsService.runForget,
	copyToMirrors: backupsService.copyToMirrors,
	getBackupProgress: backupsService.getBackupProgress,
};
