import type { NotificationConfig } from "~/schemas/notifications";
import { buildEmailShoutrrrUrl } from "./email";
import { buildSlackShoutrrrUrl } from "./slack";
import { buildDiscordShoutrrrUrl } from "./discord";
import { buildGotifyShoutrrrUrl } from "./gotify";
import { buildNtfyShoutrrrUrl } from "./ntfy";
import { buildPushoverShoutrrrUrl } from "./pushover";
import { buildTelegramShoutrrrUrl } from "./telegram";
import { buildGenericShoutrrrUrl } from "./generic";
import { buildCustomShoutrrrUrl } from "./custom";

export const buildShoutrrrUrl = (config: NotificationConfig) => {
	switch (config.type) {
		case "email":
			return buildEmailShoutrrrUrl(config);
		case "slack":
			return buildSlackShoutrrrUrl(config);
		case "discord":
			return buildDiscordShoutrrrUrl(config);
		case "gotify":
			return buildGotifyShoutrrrUrl(config);
		case "ntfy":
			return buildNtfyShoutrrrUrl(config);
		case "pushover":
			return buildPushoverShoutrrrUrl(config);
		case "telegram":
			return buildTelegramShoutrrrUrl(config);
		case "generic":
			return buildGenericShoutrrrUrl(config);
		case "custom":
			return buildCustomShoutrrrUrl(config);
		default: {
			const _exhaustive: never = config;
			throw new Error(`Unsupported notification type: ${(_exhaustive as NotificationConfig).type}`);
		}
	}
};
