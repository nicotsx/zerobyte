import { Hono } from "hono";
import { validator } from "hono-openapi";
import {
	createApiKeyBody,
	createApiKeyDto,
	deleteApiKeyDto,
	getApiKeysDto,
	type CreateApiKeyDto,
	type ListApiKeysDto,
} from "./api-keys.dto";
import { MAX_API_KEYS_PER_USER, countActiveApiKeys, hasApiKey, listApiKeys } from "./api-keys.service";
import { requireAuth, requireBrowserSession } from "../auth/auth.middleware";
import { auth } from "~/server/lib/auth";
import { userHasCredentialPassword, verifyUserPassword } from "../auth/helpers";

export const apiKeysController = new Hono()
	.get("/api-keys", requireAuth, requireBrowserSession, getApiKeysDto, async (c) => {
		const user = c.get("user");
		const organizationId = c.get("organizationId");
		const apiKeys = await listApiKeys(user.id, organizationId);

		return c.json<ListApiKeysDto>({ apiKeys, limit: MAX_API_KEYS_PER_USER });
	})
	.post(
		"/api-keys",
		requireAuth,
		requireBrowserSession,
		createApiKeyDto,
		validator("json", createApiKeyBody),
		async (c) => {
			const user = c.get("user");
			const organizationId = c.get("organizationId");
			const { expiresIn, name, password } = c.req.valid("json");

			const hasCredentialPassword = await userHasCredentialPassword(user.id);
			if (!hasCredentialPassword) {
				return c.json({ message: "A local credential password is required to create API keys" }, 403);
			}

			const isPasswordValid = await verifyUserPassword({ userId: user.id, password });
			if (!isPasswordValid) {
				return c.json({ message: "Invalid password" }, 401);
			}

			const apiKeyCount = await countActiveApiKeys(user.id);
			if (apiKeyCount >= MAX_API_KEYS_PER_USER) {
				return c.json({ message: "API key limit reached" }, 409);
			}

			const apiKey = await auth.api.createApiKey({
				body: {
					name,
					expiresIn: expiresIn ?? undefined,
					userId: user.id,
					metadata: { organizationId },
					rateLimitEnabled: false,
				},
			});

			return c.json<CreateApiKeyDto>({
				id: apiKey.id,
				name: apiKey.name,
				key: apiKey.key,
				createdAt: apiKey.createdAt.toISOString(),
				expiresAt: apiKey.expiresAt?.toISOString() ?? null,
				lastRequestAt: apiKey.lastRequest?.toISOString() ?? null,
			});
		},
	)
	.delete("/api-keys/:keyId", requireAuth, requireBrowserSession, deleteApiKeyDto, async (c) => {
		const user = c.get("user");
		const organizationId = c.get("organizationId");
		const keyId = c.req.param("keyId");

		const belongsToUserOrganization = await hasApiKey(user.id, organizationId, keyId);
		if (!belongsToUserOrganization) {
			return c.json({ message: "API key not found" }, 404);
		}

		await auth.api.deleteApiKey({
			headers: c.req.raw.headers,
			body: { keyId },
		});

		return c.json({ success: true });
	});
