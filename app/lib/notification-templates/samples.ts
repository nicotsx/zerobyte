import type { NotificationTemplateContext, NotificationTemplateKey } from "./catalog";

const backup = { schedule: "Nightly documents", source: "Documents", repository: "Cloud backup" };
const result = { ...backup, duration: "1m 24s", files: "1,250", dataAdded: "128 MiB", dataStored: "96 MiB" };

export const notificationTemplateSamples: Record<NotificationTemplateKey, NotificationTemplateContext> = {
	backup_start: backup,
	backup_success: result,
	backup_warning: { ...result, error: "Some files changed during backup." },
	backup_failure: { ...backup, error: "Permission denied. Check access to the source and repository." },
	mirror_failure: {
		schedule: "Nightly documents",
		sourceRepository: "Cloud backup",
		mirrorRepository: "Offsite mirror",
		error: "Cloud connection lost.",
	},
	test: { destination: "Backup alerts" },
};
