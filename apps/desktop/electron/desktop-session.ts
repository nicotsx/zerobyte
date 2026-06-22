import { app, session } from "electron";
import { inferDateTimePreferences } from "@zerobyte/core/utils";

export const launchSecretHeader = "X-Zerobyte-Desktop-Launch-Secret";

export const createDesktopSession = async (serverUrl: string, launchSecret: string) => {
	const response = await fetch(`${serverUrl}/api/v1/desktop/session`, {
		method: "POST",
		headers: {
			[launchSecretHeader]: launchSecret,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(inferDateTimePreferences(app.getLocale())),
	});

	if (!response.ok) {
		throw new Error(`Desktop session failed: ${await response.text()}`);
	}

	const authCookies = response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.filter(Boolean);

	for (const cookie of authCookies) {
		const [name, ...valueParts] = cookie.split("=");
		const value = valueParts.join("=");
		if (name && value) {
			await session.defaultSession.cookies.set({
				url: serverUrl,
				name,
				value,
				path: "/",
				httpOnly: true,
				sameSite: "lax",
			});
		}
	}

	return authCookies.join("; ");
};
