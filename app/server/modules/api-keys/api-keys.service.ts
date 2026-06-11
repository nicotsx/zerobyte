import { db } from "~/server/db/db";
import { parseApiKeyOrganizationId } from "./api-key-metadata";

export const MAX_API_KEYS_PER_USER_ORG = 10;

export const listApiKeys = async (userId: string, organizationId: string) => {
	const rows = await db.query.apikey.findMany({
		where: { referenceId: userId },
		orderBy: (table, { desc }) => [desc(table.createdAt)],
	});

	return rows
		.filter((row) => parseApiKeyOrganizationId(row.metadata) === organizationId)
		.map((row) => ({
			id: row.id,
			name: row.name,
			createdAt: row.createdAt.toISOString(),
			expiresAt: row.expiresAt?.toISOString() ?? null,
			lastRequestAt: row.lastRequest?.toISOString() ?? null,
		}));
};

export const countApiKeys = async (userId: string, organizationId: string) => {
	const rows = await db.query.apikey.findMany({
		where: { referenceId: userId },
		columns: { metadata: true },
	});

	return rows.filter((row) => parseApiKeyOrganizationId(row.metadata) === organizationId).length;
};

export const hasApiKey = async (userId: string, organizationId: string, apiKeyId: string) => {
	const row = await db.query.apikey.findFirst({
		where: {
			AND: [{ id: apiKeyId }, { referenceId: userId }],
		},
		columns: { metadata: true },
	});

	return parseApiKeyOrganizationId(row?.metadata ?? null) === organizationId;
};

export const getApiKeyOrganizationId = async (apiKeyId: string) => {
	const apiKeyRecord = await db.query.apikey.findFirst({
		where: { id: apiKeyId },
		columns: { metadata: true },
	});

	return parseApiKeyOrganizationId(apiKeyRecord?.metadata);
};
