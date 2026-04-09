import type { NotificationConfig } from "~/schemas/notifications";

export const buildSlackShoutrrrUrl = (config: Extract<NotificationConfig, { type: "slack" }>) => {
	const url = new URL(config.webhookUrl);
	const pathParts = url.pathname.split("/").filter(Boolean);

	if (pathParts.length < 4 || pathParts[0] !== "services") {
		throw new Error("Invalid Slack webhook URL format");
	}

	const [, tokenA, tokenB, tokenC] = pathParts;
	const shoutrrrUrl = new URL("slack://placeholder");
	shoutrrrUrl.username = "hook";
	shoutrrrUrl.password = `${tokenA}-${tokenB}-${tokenC}`;
	shoutrrrUrl.hostname = "webhook";

	if (config.username) {
		shoutrrrUrl.searchParams.append("username", config.username);
	}
	if (config.iconEmoji) {
		shoutrrrUrl.searchParams.append("icon_emoji", config.iconEmoji);
	}

	return shoutrrrUrl.toString().replace("/?", "?");
};
