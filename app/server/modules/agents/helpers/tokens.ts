import crypto from "node:crypto";
import { db } from "~/server/db/db";
import { cryptoUtils } from "~/server/utils/crypto";
import { LOCAL_AGENT_ID, LOCAL_AGENT_KIND, LOCAL_AGENT_NAME } from "../constants";

const TOKEN_PREFIX = "zba1";
const TOKEN_SECRET_BYTES = 32;
const MAX_AGENT_ID_BYTES = 128;
const MAX_CREDENTIAL_VERSION = 2_147_483_647;

export type AuthenticatedAgentConnection = {
	agentId: string;
	organizationId: string | null;
	agentName: string;
	agentKind: "local" | "remote";
	credentialVersion: number;
};

type ParsedEnrollmentToken = {
	agentId: string;
	credentialVersion: number;
	secret: Buffer;
};

const decodeBase64UrlCanonical = (value: string) => {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) {
		return null;
	}

	const decoded = Buffer.from(value, "base64url");
	if (decoded.toString("base64url") !== value) {
		return null;
	}

	return decoded;
};

export const parseEnrollmentToken = (token: string): ParsedEnrollmentToken | null => {
	if (token.length > 512) {
		return null;
	}

	const parts = token.split(".");
	if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) {
		return null;
	}

	const agentIdBytes = decodeBase64UrlCanonical(parts[1] ?? "");
	const versionText = parts[2] ?? "";
	const secret = decodeBase64UrlCanonical(parts[3] ?? "");

	if (!agentIdBytes || agentIdBytes.byteLength === 0 || agentIdBytes.byteLength > MAX_AGENT_ID_BYTES) {
		return null;
	}
	if (!/^(0|[1-9][0-9]{0,9})$/.test(versionText)) {
		return null;
	}
	if (!secret || secret.byteLength !== TOKEN_SECRET_BYTES) {
		return null;
	}

	const credentialVersion = Number(versionText);

	if (!Number.isSafeInteger(credentialVersion) || credentialVersion > MAX_CREDENTIAL_VERSION) {
		return null;
	}

	const agentId = agentIdBytes.toString("utf8");

	if (Buffer.from(agentId, "utf8").compare(agentIdBytes) !== 0) {
		return null;
	}

	return { agentId, credentialVersion, secret };
};

const deriveEnrollmentHmacKey = async () => {
	const keyHex = await cryptoUtils.deriveSecret("zerobyte:remote-agent-enrollment:hmac-sha256:v1");
	return Buffer.from(keyHex, "hex");
};

export const hashTokenParts = async (parsed: ParsedEnrollmentToken) => {
	const key = await deriveEnrollmentHmacKey();
	const agentId = Buffer.from(parsed.agentId, "utf8").toString("base64url");
	const input = `${TOKEN_PREFIX}.${agentId}.${parsed.credentialVersion}.${parsed.secret.toString("base64url")}`;

	return crypto.createHmac("sha256", key).update(input).digest("hex");
};

export const createEnrollmentToken = async (agentId: string, credentialVersion: number) => {
	const encodedAgentId = Buffer.from(agentId, "utf8").toString("base64url");
	const secret = crypto.randomBytes(TOKEN_SECRET_BYTES);
	const encodedSecret = secret.toString("base64url");
	const token = `${TOKEN_PREFIX}.${encodedAgentId}.${credentialVersion}.${encodedSecret}`;
	const parsed = { agentId, credentialVersion, secret };

	const credentialHash = await hashTokenParts(parsed);

	return { token, credentialHash };
};

export const deriveLocalAgentToken = async () => {
	return cryptoUtils.deriveSecret("zerobyte:local-agent-token");
};

export const validateLocalAgentToken = async (token: string): Promise<AuthenticatedAgentConnection | null> => {
	const localToken = await deriveLocalAgentToken();
	if (!cryptoUtils.timingSafeEqualString(token, localToken)) {
		return null;
	}

	return {
		agentId: LOCAL_AGENT_ID,
		organizationId: null,
		agentName: LOCAL_AGENT_NAME,
		agentKind: LOCAL_AGENT_KIND,
		credentialVersion: 0,
	};
};

// Private loopback compatibility name. Public routes must call validateRemoteAgentToken directly.
export const validateAgentToken = validateLocalAgentToken;

export const validateRemoteAgentToken = async (token: string): Promise<AuthenticatedAgentConnection | null> => {
	const parsed = parseEnrollmentToken(token);
	if (!parsed) {
		return null;
	}

	const agent = await db.query.agentsTable.findFirst({ where: { id: parsed.agentId } });

	if (
		!agent ||
		agent.kind !== "remote" ||
		!agent.organizationId ||
		agent.revokedAt !== null ||
		agent.credentialVersion !== parsed.credentialVersion ||
		!agent.credentialHash ||
		agent.enrollmentExpiresAt !== null
	) {
		return null;
	}

	const providedHash = await hashTokenParts(parsed);

	if (!cryptoUtils.timingSafeEqualString(providedHash, agent.credentialHash)) {
		return null;
	}

	return {
		agentId: agent.id,
		organizationId: agent.organizationId,
		agentName: agent.name,
		agentKind: agent.kind,
		credentialVersion: agent.credentialVersion,
	};
};
