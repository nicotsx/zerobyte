import type { NotificationConfig } from "~/schemas/notifications";

export const buildPushoverShoutrrrUrl = (config: Extract<NotificationConfig, { type: "pushover" }>) => {
	const params = new URLSearchParams();

	if (config.devices) {
		params.append("devices", config.devices);
	}

	if (config.priority !== undefined) {
		params.append("priority", config.priority.toString());
	}

	const queryString = params.toString();
	let shoutrrrUrl = `pushover://shoutrrr:${config.apiToken}@${config.userKey}/`;

	if (queryString) {
		shoutrrrUrl += `?${queryString}`;
	}

	return shoutrrrUrl;
};
