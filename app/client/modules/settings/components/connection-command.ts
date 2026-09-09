import { APP_VERSION } from "~/client/lib/version";

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const createConnectionCommand = (controllerUrl: string, code: string) => {
	const controller = new URL(controllerUrl);
	if (controller.protocol !== "wss:" && controller.protocol !== "ws:")
		throw new Error("Remote enrollment requires TLS");

	const insecure = controller.protocol === "ws:";
	controller.protocol = insecure ? "http:" : "https:";

	const origin = shellQuote(controller.origin);
	const enrollmentCode = shellQuote(code);

	const release = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$/.test(APP_VERSION) ? APP_VERSION : "latest";
	return `curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://zerobyte.app/install.sh | sudo env ZEROBYTE_AGENT_VERSION=${shellQuote(release)} bash -s -- --controller ${origin} --code ${enrollmentCode}${insecure ? " --allow-insecure" : ""}`;
};
