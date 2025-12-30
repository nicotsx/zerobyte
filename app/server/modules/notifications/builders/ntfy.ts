import type { NotificationConfig } from "~/schemas/notifications";

export function buildNtfyShoutrrrUrl(config: Extract<NotificationConfig, { type: "ntfy" }>): string {
	let shoutrrrUrl: string;

	const params = new URLSearchParams();

	const auth =
		config.username && config.password
			? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
			: "";

	const auth =
		config.accessToken
			? `:${encodeURIComponent(config.accessToken)}@`
			: config.username && config.password
				? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@`
				: "";

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
}
