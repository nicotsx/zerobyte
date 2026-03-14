import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db/db";
import { agentTokensTable } from "~/server/db/schema";
import { cryptoUtils } from "~/server/utils/crypto";

export const generateToken = () => {
	return `zbk_${crypto.randomBytes(32).toString("hex")}`;
};

export const hashToken = (token: string) => {
	return crypto.createHash("sha256").update(token).digest("hex");
};

export const deriveLocalAgentToken = async () => {
	const derived = await cryptoUtils.deriveSecret("zerobyte:local-agent-token");
	return `zbk_${derived}`;
};

export const createAgentToken = async ({
	name,
	agentId,
	createdBy,
}: {
	name: string;
	agentId: string;
	createdBy: string;
}) => {
	const plaintext = generateToken();
	const tokenHash = hashToken(plaintext);
	const tokenPrefix = plaintext.slice(0, 12);

	const id = Bun.randomUUIDv7();
	await db.insert(agentTokensTable).values({
		id,
		name,
		tokenHash,
		tokenPrefix,
		agentId,
		createdBy,
	});

	return { id, name, tokenPrefix, plaintext };
};

export const validateAgentToken = async (token: string) => {
	const localToken = await deriveLocalAgentToken();
	if (token === localToken) {
		return { agentId: "local", organizationId: null, agentName: "local" };
	}

	const tokenHash = hashToken(token);

	const record = await db.query.agentTokensTable.findFirst({
		where: { tokenHash, revokedAt: { isNull: true } },
		with: { agent: true },
	});

	if (!record) return null;

	await db.update(agentTokensTable).set({ lastUsedAt: Date.now() }).where(eq(agentTokensTable.id, record.id));

	return {
		agentId: record.agentId,
		organizationId: record.agent.organizationId,
		agentName: record.name,
	};
};

export const revokeAgentToken = async (tokenId: string, agentId: string) => {
	const token = await db.query.agentTokensTable.findFirst({
		where: { id: tokenId, agentId, revokedAt: { isNull: true } },
	});

	if (!token) return false;

	await db.update(agentTokensTable).set({ revokedAt: Date.now() }).where(eq(agentTokensTable.id, tokenId));

	return true;
};

export const listAgentTokens = async (agentId: string) => {
	return db.query.agentTokensTable.findMany({
		where: { agentId },
		columns: { id: true, name: true, tokenPrefix: true, lastUsedAt: true, revokedAt: true, createdAt: true },
	});
};
