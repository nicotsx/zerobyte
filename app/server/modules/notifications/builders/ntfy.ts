import type { NotificationConfig } from "~/schemas/notifications";

export const buildNtfyShoutrrrUrl = (config: Extract<NotificationConfig, { type: "ntfy" }>) => {
	let shoutrrrUrl: string;

	const params = new URLSearchParams();
	const { username, password, accessToken } = config;

	let auth = "";

	if (username && password) {
		auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
	}

	if (accessToken) {
		auth = `:${encodeURIComponent(accessToken)}@`;
	}

	if (config.serverUrl) {
		const url = new URL(config.serverUrl);
		const hostname = url.hostname;
		const port = url.port ? `:${url.port}` : "";
		const scheme = url.protocol === "https:" ? "https" : "http";

		params.append("scheme", scheme);

		shoutrrrUrl = `ntfy://${auth}${hostname}${port}/${config.topic}`;
	} else {
		shoutrrrUrl = `ntfy://${auth}ntfy.sh/${config.topic}`;
	}

	if (config.priority) {
		params.append("priority", config.priority);
	}

	if (params.toString()) {
		shoutrrrUrl += `?${params.toString()}`;
	}

	return shoutrrrUrl;
};
