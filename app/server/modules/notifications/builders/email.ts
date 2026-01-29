import type { NotificationConfig } from "~/schemas/notifications";

export const buildEmailShoutrrrUrl = (config: Extract<NotificationConfig, { type: "email" }>) => {
	const auth =
		config.username && config.password
			? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
			: "";
	const host = `${config.smtpHost}:${config.smtpPort}`;
	const toRecipients = config.to.map((email) => encodeURIComponent(email)).join(",");
	const useStartTLS = config.useTLS ? "yes" : "no";
	const fromNameParam = config.fromName ? `&fromname=${encodeURIComponent(config.fromName)}` : "";

	return `smtp://${auth}${host}/?from=${encodeURIComponent(config.from)}${fromNameParam}&to=${toRecipients}&starttls=${useStartTLS}`;
};
