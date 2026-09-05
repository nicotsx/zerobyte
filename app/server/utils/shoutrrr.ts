import { logger, safeExec, sanitizeSensitiveData } from "@zerobyte/core/node";
import { toMessage } from "./errors";

interface SendNotificationParams {
	shoutrrrUrl: string;
	title: string;
	body: string;
}

const telegramMaxBytes = 4096;
const truncationNotice = "\n\n[Truncated; see backup logs for details.]";

const truncateUtf8 = (value: string, maxBytes: number, suffix: string) => {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;

	const availableBytes = maxBytes - Buffer.byteLength(suffix, "utf8");
	const buffer = new Uint8Array(availableBytes);
	const { read } = new TextEncoder().encodeInto(value, buffer);
	return value.slice(0, read) + suffix;
};

export async function sendNotification(params: SendNotificationParams) {
	const { shoutrrrUrl } = params;
	let { title, body } = params;

	try {
		const messageBytes = Buffer.byteLength(title, "utf8") + Buffer.byteLength(body, "utf8") + 1;
		if (shoutrrrUrl.toLowerCase().startsWith("telegram:") && messageBytes > telegramMaxBytes) {
			const maxTitleBytes = telegramMaxBytes - Buffer.byteLength(truncationNotice, "utf8") - 1;
			title = truncateUtf8(title, maxTitleBytes, "…");
			const maxBodyBytes = telegramMaxBytes - Buffer.byteLength(title, "utf8") - 1;
			body = truncateUtf8(body, maxBodyBytes, truncationNotice);
		}

		const args = ["send", "--url", shoutrrrUrl, "--title", title, "--message", body];

		logger.debug(`Sending notification via Shoutrrr: ${title}`);

		const result = await safeExec({ command: "shoutrrr", args });

		if (result.exitCode === 0) {
			logger.debug(`Notification sent successfully: ${title}`);
			return { success: true };
		}

		const errorMessage = sanitizeSensitiveData(result.stderr || result.stdout || "Unknown error");
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
