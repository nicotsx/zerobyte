import type { NotificationConfig } from "~/schemas/notifications";

export const buildTelegramShoutrrrUrl = (config: Extract<NotificationConfig, { type: "telegram" }>) => {
	return `telegram://${config.botToken}@telegram?channels=${config.chatId}`;
};
