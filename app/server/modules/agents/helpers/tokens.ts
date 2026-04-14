import { cryptoUtils } from "~/server/utils/crypto";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

export const deriveLocalAgentToken = async () => {
	return cryptoUtils.deriveSecret("zerobyte:local-agent-token");
};

export const validateAgentToken = async (token: string) => {
	const localToken = await deriveLocalAgentToken();
	if (token === localToken) {
		return { agentId: LOCAL_AGENT_ID, organizationId: null, agentName: LOCAL_AGENT_NAME, agentKind: LOCAL_AGENT_KIND };
	}
};
