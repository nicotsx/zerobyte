import type { NotificationConfig } from "~/schemas/notifications";

export const buildGenericShoutrrrUrl = (config: Extract<NotificationConfig, { type: "generic" }>) => {
	const targetUrl = new URL(config.url);
	const shoutrrrUrl = new URL(`generic://${targetUrl.host}${targetUrl.pathname}`);

	for (const [key, value] of targetUrl.searchParams.entries()) {
		const reservedKeys = ["contenttype", "disabletls", "messagekey", "method", "template", "title", "titlekey"];
		if (reservedKeys.includes(key.toLowerCase())) {
			shoutrrrUrl.searchParams.append(`_${key}`, value);
		} else {
			shoutrrrUrl.searchParams.append(key, value);
		}
	}

	if (targetUrl.protocol === "http:") {
		shoutrrrUrl.searchParams.append("disabletls", "yes");
	}

	if (config.method) {
		shoutrrrUrl.searchParams.append("method", config.method);
	}

	if (config.contentType) {
		shoutrrrUrl.searchParams.append("contenttype", config.contentType);
	}

	if (config.useJson) {
		shoutrrrUrl.searchParams.append("template", "json");
	}

	if (config.titleKey) {
		shoutrrrUrl.searchParams.append("titlekey", config.titleKey);
	}

	if (config.messageKey) {
		shoutrrrUrl.searchParams.append("messagekey", config.messageKey);
	}

	if (config.headers) {
		for (const header of config.headers) {
			const [key, ...valueParts] = header.split(":");
			if (key && valueParts.length > 0) {
				shoutrrrUrl.searchParams.append(`@${key.trim()}`, valueParts.join(":").trim());
			}
		}
	}

	return shoutrrrUrl.toString();
};
