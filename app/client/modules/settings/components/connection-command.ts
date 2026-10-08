import { APP_VERSION } from "~/client/lib/version";

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export type ConnectionPurpose = "connect" | "reconnect";

export const createConnectionCommand = (
	controllerUrl: string,
	code: string,
	purpose: ConnectionPurpose = "connect",
) => {
	const controller = new URL(controllerUrl);
	if (controller.protocol !== "wss:") throw new Error("Remote enrollment requires TLS");
	controller.protocol = "https:";
	const origin = shellQuote(controller.origin);
	const enrollmentCode = shellQuote(code);
	let release = "latest";
	if (/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$/.test(APP_VERSION)) {
		release = APP_VERSION;
	}

	return `curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://zerobyte.app/install.sh | sudo env ZEROBYTE_AGENT_VERSION=${shellQuote(release)} bash -s -- --controller ${origin} --code ${enrollmentCode}${purpose === "reconnect" ? " --reconnect" : ""}`;
};
