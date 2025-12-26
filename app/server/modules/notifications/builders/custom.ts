import type { NotificationConfig } from "~/schemas/notifications";

export const buildCustomShoutrrrUrl = (config: Extract<NotificationConfig, { type: "custom" }>) => {
	return config.shoutrrrUrl;
};
