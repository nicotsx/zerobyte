import type { NotificationConfig } from "~/schemas/notifications";

export const buildDiscordShoutrrrUrl = (config: Extract<NotificationConfig, { type: "discord" }>) => {
	const url = new URL(config.webhookUrl);
	const pathParts = url.pathname.split("/").filter(Boolean);

	if (pathParts.length < 4 || pathParts[0] !== "api" || pathParts[1] !== "webhooks") {
		throw new Error("Invalid Discord webhook URL format");
	}

	const [, , webhookId, webhookToken] = pathParts;

	let shoutrrrUrl = `discord://${webhookToken}@${webhookId}`;

	const params = new URLSearchParams();
	if (config.username) {
		params.append("username", config.username);
	}
	if (config.avatarUrl) {
		params.append("avatarurl", config.avatarUrl);
	}
	if (config.threadId) {
		params.append("thread_id", config.threadId);
	}

	if (params.toString()) {
		shoutrrrUrl += `?${params.toString()}`;
	}

	return shoutrrrUrl;
};
