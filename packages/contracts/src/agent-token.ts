export const AGENT_TOKEN_PREFIX = "zba1";

export const parseAgentToken = (token: string) => {
	const [prefix, agentId, version, secret, ...rest] = token.split(".");

	if (prefix !== AGENT_TOKEN_PREFIX || !agentId || !secret || rest.length > 0) return null;
	if (!version || !/^\d+$/.test(version)) return null;

	return { agentId, credentialVersion: Number(version) };
};
