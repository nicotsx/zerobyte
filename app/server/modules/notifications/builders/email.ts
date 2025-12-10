import type { NotificationConfig } from "~/schemas/notifications";

export function buildEmailShoutrrrUrl(config: Extract<NotificationConfig, { type: "email" }>): string {
	const auth = config.username && config.password
		? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
		: "";
	const host = `${config.smtpHost}:${config.smtpPort}`;
	const toRecipients = config.to.map((email) => encodeURIComponent(email)).join(",");
	const useStartTLS = config.useTLS ? "yes" : "no";

	return `smtp://${auth}${host}/?from=${encodeURIComponent(config.from)}&to=${toRecipients}&starttls=${useStartTLS}`;
}
