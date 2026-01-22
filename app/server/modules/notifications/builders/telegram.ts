import type { NotificationConfig } from "~/schemas/notifications";

export const buildTelegramShoutrrrUrl = (config: Extract<NotificationConfig, { type: "telegram" }>) => {
	let shoutrrrUrl =  `telegram://${config.botToken}@telegram?channels=${config.chatId}`;
	if (config.threadId) {
		shoutrrrUrl += `:${config.threadId}`;
	}
	return shoutrrrUrl;
};
