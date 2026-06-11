import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";

const apiKeyResponse = z.object({
	id: z.string(),
	name: z.string().nullable(),
	createdAt: z.string(),
	expiresAt: z.string().nullable(),
	lastRequestAt: z.string().nullable(),
});

const listApiKeysResponse = z.object({
	apiKeys: apiKeyResponse.array(),
	limit: z.number(),
});

export type ListApiKeysDto = z.infer<typeof listApiKeysResponse>;

export const getApiKeysDto = describeRoute({
	description: "List API keys for the current user in the active organization",
	operationId: "getApiKeys",
	tags: ["API Keys"],
	responses: {
		200: {
			description: "List of API keys",
			content: {
				"application/json": {
					schema: resolver(listApiKeysResponse),
				},
			},
		},
	},
});

export const createApiKeyBody = z.object({
	name: z.string().trim().min(1).max(32),
	password: z.string(),
	expiresIn: z.number().int().min(1).nullable().optional(),
});

const createApiKeyResponse = apiKeyResponse.extend({
	key: z.string(),
});

export type CreateApiKeyDto = z.infer<typeof createApiKeyResponse>;

export const createApiKeyDto = describeRoute({
	description: "Create an API key for the current user in the active organization",
	operationId: "createApiKey",
	tags: ["API Keys"],
	responses: {
		200: {
			description: "API key created",
			content: {
				"application/json": {
					schema: resolver(createApiKeyResponse),
				},
			},
		},
		401: {
			description: "Invalid password",
		},
		403: {
			description: "Local credential password required",
		},
		409: {
			description: "API key limit reached",
		},
	},
});

export const deleteApiKeyDto = describeRoute({
	description: "Revoke an API key for the current user in the active organization",
	operationId: "deleteApiKey",
	tags: ["API Keys"],
	responses: {
		200: {
			description: "API key revoked",
		},
		404: {
			description: "API key not found",
		},
	},
});
