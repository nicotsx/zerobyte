import { toControllerOrigin } from "@zerobyte/contracts/agent-connection";
import { APP_VERSION } from "~/client/lib/version";

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]*)?$/;

export const AGENT_RELEASE = RELEASE_TAG.test(APP_VERSION) ? APP_VERSION : "latest";

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export const createConnectionCommand = (controllerUrl: string, code: string) => {
	const origin = toControllerOrigin(controllerUrl);
	const insecure = origin.startsWith("http:") ? " --allow-insecure" : "";

	return `curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' https://zerobyte.app/install.sh | sudo env ZEROBYTE_AGENT_VERSION=${shellQuote(AGENT_RELEASE)} bash -s -- --controller ${shellQuote(origin)} --code ${shellQuote(code)}${insecure}`;
};
