import { cryptoUtils } from "~/server/utils/crypto";

export const deriveLocalAgentToken = async () => {
	return cryptoUtils.deriveSecret("zerobyte:local-agent-token");
};

export const validateAgentToken = async (token: string) => {
	const localToken = await deriveLocalAgentToken();
	if (token === localToken) {
		return { agentId: "local", organizationId: null, agentName: "local" };
	}
};
