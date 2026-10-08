import crypto from "node:crypto";
import { db } from "~/server/db/db";
import { cryptoUtils } from "~/server/utils/crypto";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

const TOKEN_PREFIX = "zba1";

export type AgentIdentity = {
	agentId: string;
	agentName: string;
	credentialVersion: number;
} & ({ agentKind: "local"; organizationId: null } | { agentKind: "remote"; organizationId: string });

export const parseAgentToken = (token: string) => {
	const [prefix, agentId, version, secret, ...rest] = token.split(".");

	if (prefix !== TOKEN_PREFIX || !agentId || !secret || rest.length > 0) return null;
	if (!version || !/^\d+$/.test(version)) return null;

	return { agentId, credentialVersion: Number(version) };
};

export const hashAgentToken = async (token: string) => {
	const key = await cryptoUtils.deriveSecret("zerobyte:remote-agent-enrollment:hmac-sha256:v1");

	return crypto.createHmac("sha256", Buffer.from(key, "hex")).update(token).digest("hex");
};

export const createAgentToken = async (agentId: string, credentialVersion: number) => {
	const secret = crypto.randomBytes(32).toString("base64url");
	const token = `${TOKEN_PREFIX}.${agentId}.${credentialVersion}.${secret}`;

	return { token, credentialHash: await hashAgentToken(token) };
};

export const deriveLocalAgentToken = () => cryptoUtils.deriveSecret("zerobyte:local-agent-token");

export const validateLocalAgentToken = async (token: string): Promise<AgentIdentity | null> => {
	if (!cryptoUtils.timingSafeEqualString(token, await deriveLocalAgentToken())) return null;

	return {
		agentId: LOCAL_AGENT_ID,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		organizationId: null,
		credentialVersion: 0,
	};
};

export const validateRemoteAgentToken = async (token: string): Promise<AgentIdentity | null> => {
	const parsed = parseAgentToken(token);

	if (!parsed) return null;

	const agent = await db.query.agentsTable.findFirst({ where: { id: parsed.agentId } });

	if (
		agent?.kind !== "remote" ||
		!agent.organizationId ||
		!agent.credentialHash ||
		agent.revokedAt !== null ||
		agent.enrollmentExpiresAt !== null ||
		agent.credentialVersion !== parsed.credentialVersion
	) {
		return null;
	}

	if (!cryptoUtils.timingSafeEqualString(await hashAgentToken(token), agent.credentialHash)) return null;

	return {
		agentId: agent.id,
		agentName: agent.name,
		agentKind: "remote",
		organizationId: agent.organizationId,
		credentialVersion: agent.credentialVersion,
	};
};
