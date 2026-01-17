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
	description: "Download the organization's Restic password for backup recovery. Requires organization owner or admin role and password re-authentication.",
	tags: ["System"],
	operationId: "downloadResticPassword",
	responses: {
		200: {
			description: "Organization's Restic password",
			content: {
				"text/plain": {
					schema: { type: "string" },
				},
			},
		},
	},
});

export const registrationStatusResponse = type({
	disabled: "boolean",
});

export type RegistrationStatusDto = typeof registrationStatusResponse.infer;

export const registrationStatusBody = type({
	disabled: "boolean",
});

export const getRegistrationStatusDto = describeRoute({
	description: "Get the current registration status for new users",
	tags: ["System"],
	operationId: "getRegistrationStatus",
	responses: {
		200: {
			description: "Registration status",
			content: {
				"application/json": {
					schema: resolver(registrationStatusResponse),
				},
			},
		},
	},
});

export const setRegistrationStatusDto = describeRoute({
	description: "Update the registration status for new users. Requires global admin role.",
	tags: ["System"],
	operationId: "setRegistrationStatus",
	responses: {
		200: {
			description: "Registration status updated",
			content: {
				"application/json": {
					schema: resolver(registrationStatusResponse),
				},
			},
		},
	},
});
