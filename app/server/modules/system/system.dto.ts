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

export const fullExportBodySchema = type({
	includeMetadata: "boolean = false",
	password: "string",
});

export type FullExportBody = typeof fullExportBodySchema.infer;

const exportResponseSchema = type({
	version: "number",
	exportedAt: "string?",
	recoveryKey: "string?",
	volumes: "unknown[]?",
	repositories: "unknown[]?",
	backupSchedules: "unknown[]?",
	notificationDestinations: "unknown[]?",
	users: type({
		id: "number?",
		username: "string",
		createdAt: "number?",
		updatedAt: "number?",
		hasDownloadedResticPassword: "boolean?",
	})
		.array()
		.optional(),
});

export type ExportFullConfigResponse = typeof exportResponseSchema.infer;

export const fullExportDto = describeRoute({
	description: "Export full configuration including all volumes, repositories, backup schedules, and notifications",
	operationId: "exportFullConfig",
	tags: ["Config Export"],
	responses: {
		200: {
			description: "Full configuration export",
			content: {
				"application/json": {
					schema: resolver(exportResponseSchema),
				},
			},
		},
	},
});
