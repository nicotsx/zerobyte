import { exec } from "./spawn";
import { logger } from "./logger";
import { toMessage } from "./errors";

export interface SendNotificationParams {
	shoutrrrUrl: string;
	title: string;
	body: string;
}

export async function sendNotification(params: SendNotificationParams) {
	const { shoutrrrUrl, title, body } = params;

	try {
		const args = ["send", "--url", shoutrrrUrl, "--title", title, "--message", body];

		logger.debug(`Sending notification via Shoutrrr: ${title}`);

		const result = await exec({ command: "shoutrrr", args });

		if (result.exitCode === 0) {
			logger.debug(`Notification sent successfully: ${title}`);
			return { success: true };
		}

		const errorMessage = result.stderr || result.stdout || "Unknown error";
		logger.error(`Failed to send notification: ${errorMessage}`);
		return {
			success: false,
			error: errorMessage,
		};
	} catch (error) {
		const errorMessage = toMessage(error);
		logger.error(`Error sending notification: ${errorMessage}`);
		return {
			success: false,
			error: errorMessage,
		};
	}
}
