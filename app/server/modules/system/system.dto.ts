import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

export const capabilitiesSchema = type({
	rclone: "boolean",
	sysAdmin: "boolean",
});

export const systemInfoResponse = type({
	capabilities: capabilitiesSchema,
});

export type SystemInfoDto = typeof systemInfoResponse.infer;

export const releaseInfoSchema = type({
	version: "string",
	url: "string",
	publishedAt: "string",
	body: "string",
});

export const updateInfoResponse = type({
	currentVersion: "string",
	latestVersion: "string",
	hasUpdate: "boolean",
	missedReleases: releaseInfoSchema.array(),
});

export type UpdateInfoDto = typeof updateInfoResponse.infer;

export const systemInfoDto = describeRoute({
	description: "Get system information including available capabilities",
	tags: ["System"],
	operationId: "getSystemInfo",
	responses: {
		200: {
			description: "System information with enabled capabilities",
			content: {
				"application/json": {
					schema: resolver(systemInfoResponse),
				},
			},
		},
	},
});

export const getUpdatesDto = describeRoute({
	description: "Check for application updates from GitHub",
	tags: ["System"],
	operationId: "getUpdates",
	responses: {
		200: {
			description: "Update information and missed releases",
			content: {
				"application/json": {
					schema: resolver(updateInfoResponse),
				},
			},
		},
	},
});

export const downloadResticPasswordBodySchema = type({
	password: "string",
});

export const downloadResticPasswordDto = describeRoute({
	description: "Download the Restic password file for backup recovery. Requires password re-authentication.",
	tags: ["System"],
	operationId: "downloadResticPassword",
	responses: {
		200: {
			description: "Restic password file content",
			content: {
				"text/plain": {
					schema: { type: "string" },
				},
			},
		},
	},
});

export const ssoProviderSchema = type({
	id: "string",
	providerId: "string",
	issuer: "string",
	domain: "string",
});

export const listSSOProvidersResponse = ssoProviderSchema.array();

export const listSSOProvidersDto = describeRoute({
	description: "List all configured SSO providers",
	tags: ["Auth"],
	operationId: "listSSOProviders",
	responses: {
		200: {
			description: "List of SSO providers",
			content: {
				"application/json": {
					schema: resolver(listSSOProvidersResponse),
				},
			},
		},
	},
});

export const deleteSSOProviderDto = describeRoute({
	description: "Delete an SSO provider",
	tags: ["Auth"],
	operationId: "deleteSSOProvider",
	responses: {
		200: {
			description: "Provider deleted",
		},
	},
});
