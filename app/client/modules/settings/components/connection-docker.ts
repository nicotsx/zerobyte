import { toControllerOrigin } from "@zerobyte/contracts/agent-connection";
import { APP_VERSION } from "~/client/lib/version";
import { AGENT_RELEASE } from "./connection-command";

const imageTag = /^(nightly|sha-[a-f0-9]{40})$/.test(APP_VERSION) ? APP_VERSION : AGENT_RELEASE;

const composeString = (value: string) => JSON.stringify(value.replaceAll("$", () => "$$"));

export const createDockerCompose = (controllerUrl: string, code: string, machineName: string) => {
	const origin = toControllerOrigin(controllerUrl);
	const hostname = machineName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.slice(0, 63)
		.replace(/^-|-$/g, "");

	const insecureEnvironment = origin.startsWith("http:") ? '\n      ZEROBYTE_AGENT_ALLOW_INSECURE_HTTP: "true"' : "";

	return `services:
  agent:
    image: ghcr.io/nicotsx/zerobyte-agent:${imageTag}
    hostname: ${composeString(hostname || "zerobyte-agent")}
    restart: unless-stopped
    environment:
      ZEROBYTE_CONTROLLER_URL: ${composeString(origin)}${insecureEnvironment}
      ZEROBYTE_AGENT_ENROLLMENT_CODE: ${composeString(code)}
      ZEROBYTE_AGENT_ROOTS: >-
        [{"id":"files-1","label":"Files","path":"/data","allowBackup":true}]
    volumes:
      - agent-config:/var/lib/zerobyte-agent
      - agent-cache:/var/cache/zerobyte-agent
      - /path/on/host:/data:ro

volumes:
  agent-config:
  agent-cache:
`;
};
