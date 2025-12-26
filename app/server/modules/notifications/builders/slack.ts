import type { NotificationConfig } from "~/schemas/notifications";

export const buildSlackShoutrrrUrl = (config: Extract<NotificationConfig, { type: "slack" }>) => {
	const url = new URL(config.webhookUrl);
	const pathParts = url.pathname.split("/").filter(Boolean);

	if (pathParts.length < 4 || pathParts[0] !== "services") {
		throw new Error("Invalid Slack webhook URL format");
	}

	const [, tokenA, tokenB, tokenC] = pathParts;

	let shoutrrrUrl = `slack://hook:${tokenA}-${tokenB}-${tokenC}@webhook`;

	const params = new URLSearchParams();
	if (config.channel) {
		params.append("channel", config.channel);
	}
	if (config.username) {
		params.append("username", config.username);
	}
	if (config.iconEmoji) {
		params.append("icon_emoji", config.iconEmoji);
	}

	if (params.toString()) {
		shoutrrrUrl += `?${params.toString()}`;
	}

	return shoutrrrUrl;
};
