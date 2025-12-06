import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { type } from "arktype";
import { secretProvidersService } from "./secret-providers.service";
import {
	createSecretProviderSchema,
	updateSecretProviderSchema,
	secretProviderConfigSchema,
} from "./secret-providers.dto";
import { DEFAULT_PROVIDER_PREFIXES } from "../../db/schema-secret-providers";

export const secretProvidersController = new Hono()
	/**
	 * Get available provider types
	 * NOTE: This must be defined BEFORE /:id routes to prevent "types" from being matched as an ID
	 */
	.get(
		"/types",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Get available secret provider types",
			responses: {
				200: { description: "List of provider types with default prefixes" },
			},
		}),
		async (c) => {
			return c.json({
				types: [
					{
						id: "op-connect",
						name: "1Password Connect",
						description: "1Password Connect server for team/enterprise secrets (self-hosted)",
						defaultPrefix: DEFAULT_PROVIDER_PREFIXES["op-connect"],
						configFields: [
							{
								name: "connectHost",
								label: "Connect Host",
								type: "url",
								required: true,
								placeholder: "http://op-connect:8080",
							},
							{ name: "connectToken", label: "Connect Token", type: "password", required: true },
							{ name: "verifySsl", label: "Verify SSL Certificate", type: "boolean", required: false },
						],
					},
					{
						id: "hc-vault",
						name: "HashiCorp Vault",
						description: "HashiCorp Vault server for centralized secrets management",
						defaultPrefix: DEFAULT_PROVIDER_PREFIXES["hc-vault"],
						configFields: [
							{
								name: "vaultAddr",
								label: "Vault Address",
								type: "url",
								required: true,
								placeholder: "https://vault.example.com:8200",
							},
							{ name: "vaultToken", label: "Vault Token", type: "password", required: true },
							{
								name: "vaultNamespace",
								label: "Namespace",
								type: "text",
								required: false,
								placeholder: "admin (Enterprise only)",
							},
							{
								name: "mountPath",
								label: "Secrets Engine Mount Path",
								type: "text",
								required: false,
								placeholder: "secret",
							},
							{ name: "verifySsl", label: "Verify SSL Certificate", type: "boolean", required: false },
						],
					},
				],
			});
		},
	)

	/**
	 * Test a provider configuration before saving
	 * NOTE: This must be defined BEFORE /:id routes
	 */
	.post(
		"/test-config",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Test a provider configuration before creating",
			description: "Tests if the provided configuration can connect successfully without saving it",
			responses: {
				200: { description: "Test result with healthy status and optional error message" },
			},
		}),
		validator("json", type({ config: secretProviderConfigSchema })),
		async (c) => {
			const { config } = c.req.valid("json");
			const result = await secretProvidersService.testConfig(config);
			return c.json(result);
		},
	)

	/**
	 * List all secret providers
	 */
	.get(
		"/",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "List all secret providers",
			responses: {
				200: {
					description: "List of secret providers",
					content: {
						"application/json": {
							schema: resolver(
								type({
									providers: type({
										id: "number",
										name: "string",
										type: "'op-connect' | 'hc-vault'",
										enabled: "boolean",
										uriPrefix: "string",
										healthStatus: "'healthy' | 'unhealthy' | 'unknown'",
										lastHealthCheck: "number | null",
										lastError: "string | null",
										createdAt: "number",
										updatedAt: "number",
										configSummary: "unknown",
									}).array(),
								}),
							),
						},
					},
				},
			},
		}),
		async (c) => {
			const providers = await secretProvidersService.listProviders();
			return c.json({ providers });
		},
	)

	/**
	 * Browse secrets from a provider
	 * NOTE: This must be defined BEFORE /:id routes to prevent "env/browse" from matching /:id
	 */
	.get(
		"/:id/browse",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Browse available secrets from a provider",
			description:
				"Lists available secrets from a provider. For 1Password, this lists vaults, items, and fields. Path param can be used to navigate: empty = list vaults, 'vault' = list items, 'vault/item' = list fields. Use 'env' or 'file' as id for built-in providers.",
			responses: {
				200: {
					description: "List of browsable secret nodes",
					content: {
						"application/json": {
							schema: resolver(
								type({
									nodes: type({
										id: "string",
										name: "string",
										type: "'vault' | 'item' | 'field' | 'folder' | 'variable'",
										"uri?": "string",
										"hasChildren?": "boolean",
									}).array(),
								}),
							),
						},
					},
				},
				404: { description: "Provider not found" },
			},
		}),
		validator("param", type({ id: "string" })),
		validator("query", type({ "path?": "string" })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { path } = c.req.valid("query");
			const nodes = await secretProvidersService.browseProvider(id, path);
			return c.json({ nodes });
		},
	)

	/**
	 * Get a single secret provider
	 */
	.get(
		"/:id",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Get a secret provider by ID",
			responses: {
				200: { description: "Secret provider details" },
				404: { description: "Provider not found" },
			},
		}),
		validator("param", type({ id: "string.integer" })),
		async (c) => {
			const { id } = c.req.valid("param");
			const provider = await secretProvidersService.getProvider(Number(id));
			return c.json({ provider });
		},
	)

	/**
	 * Create a new secret provider
	 */
	.post(
		"/",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Create a new secret provider",
			responses: {
				201: { description: "Provider created successfully" },
				409: { description: "Provider with this name already exists" },
			},
		}),
		validator("json", createSecretProviderSchema),
		async (c) => {
			const body = c.req.valid("json");
			const provider = await secretProvidersService.createProvider(body);
			return c.json({ provider }, 201);
		},
	)

	/**
	 * Update a secret provider
	 */
	.patch(
		"/:id",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Update a secret provider",
			responses: {
				200: { description: "Provider updated successfully" },
				404: { description: "Provider not found" },
				409: { description: "Provider with this name already exists" },
			},
		}),
		validator("param", type({ id: "string.integer" })),
		validator("json", updateSecretProviderSchema),
		async (c) => {
			const { id } = c.req.valid("param");
			const body = c.req.valid("json");
			const provider = await secretProvidersService.updateProvider(Number(id), body);
			return c.json({ provider });
		},
	)

	/**
	 * Delete a secret provider
	 */
	.delete(
		"/:id",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Delete a secret provider",
			responses: {
				204: { description: "Provider deleted successfully" },
				404: { description: "Provider not found" },
			},
		}),
		validator("param", type({ id: "string.integer" })),
		async (c) => {
			const { id } = c.req.valid("param");
			await secretProvidersService.deleteProvider(Number(id));
			return c.body(null, 204);
		},
	)

	/**
	 * Test a secret provider's connectivity
	 */
	.post(
		"/:id/test",
		describeRoute({
			tags: ["Secret Providers"],
			summary: "Test a secret provider's connectivity",
			responses: {
				200: { description: "Test result" },
				404: { description: "Provider not found" },
			},
		}),
		validator("param", type({ id: "string.integer" })),
		async (c) => {
			const { id } = c.req.valid("param");
			const result = await secretProvidersService.testProvider(Number(id));
			return c.json(result);
		},
	);
