import { app, session } from "electron";
import { inferDateTimePreferences } from "@zerobyte/core/utils";

export const launchSecretHeader = "X-Zerobyte-Desktop-Launch-Secret";

export const createDesktopSession = async (serverUrl: string, launchSecret: string) => {
	if (new URL(serverUrl).protocol !== "https:") {
		throw new Error("Desktop sessions require HTTPS");
	}

	const response = await session.defaultSession.fetch(`${serverUrl}/api/v1/desktop/session`, {
		method: "POST",
		credentials: "include",
		redirect: "error",
		signal: AbortSignal.timeout(10_000),
		headers: {
			[launchSecretHeader]: launchSecret,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(inferDateTimePreferences(app.getLocale())),
	});

	if (!response.ok) {
		throw new Error(`Desktop session failed: ${await response.text()}`);
	}
};
