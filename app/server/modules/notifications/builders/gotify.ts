import type { NotificationConfig } from "~/schemas/notifications";

export const buildGotifyShoutrrrUrl = (config: Extract<NotificationConfig, { type: "gotify" }>) => {
	const url = new URL(config.serverUrl);
	const hostname = url.hostname;
	const port = url.port ? `:${url.port}` : "";
	const path = config.path ? `/${config.path.replace(/^\/+|\/+$/g, "")}` : "";
	const disableTLS = url.protocol === "http:";

	let shoutrrrUrl = `gotify://${hostname}${port}${path}/${config.token}`;

	const params = new URLSearchParams();

	if (disableTLS) {
		params.set("DisableTLS", "true");
	}

	if (config.priority !== undefined) {
		params.set("priority", String(config.priority));
	}

	if (params.toString()) {
		shoutrrrUrl += `?${params.toString()}`;
	}

	return shoutrrrUrl;
};
