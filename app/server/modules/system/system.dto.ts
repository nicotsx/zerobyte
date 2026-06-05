import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";

const capabilitiesSchema = z.object({
	rclone: z.boolean(),
	sysAdmin: z.boolean(),
	volumeBackends: z.array(z.enum(["directory", "nfs", "smb", "webdav", "rclone", "sftp"])),
	repositoryBackends: z.array(z.enum(["local", "s3", "r2", "gcs", "azure", "sftp", "rest", "rclone"])),
});

const systemInfoResponse = z.object({
	runtime: z.enum(["server", "desktop"]),
	capabilities: capabilitiesSchema,
});

export type SystemInfoDto = z.infer<typeof systemInfoResponse>;

const releaseInfoSchema = z.object({
	version: z.string(),
	url: z.string(),
	publishedAt: z.string(),
	body: z.string(),
});

const updateInfoResponse = z.object({
	currentVersion: z.string(),
	latestVersion: z.string(),
	hasUpdate: z.boolean(),
	missedReleases: releaseInfoSchema.array(),
});

export type UpdateInfoDto = z.infer<typeof updateInfoResponse>;

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

export const downloadResticPasswordBodySchema = z.object({
	password: z.string(),
});

export const downloadResticPasswordDto = describeRoute({
	description:
		"Download the organization's Restic password for backup recovery. Requires organization owner or admin role and may require password re-authentication.",
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

const registrationStatusResponse = z.object({
	enabled: z.boolean(),
});

export type RegistrationStatusDto = z.infer<typeof registrationStatusResponse>;

export const registrationStatusBody = z.object({
	enabled: z.boolean(),
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

const passwordLoginStatusResponse = z.object({
	enabled: z.boolean(),
});

export type PasswordLoginStatusDto = z.infer<typeof passwordLoginStatusResponse>;

export const passwordLoginStatusBody = z.object({
	enabled: z.boolean(),
});

export const getPasswordLoginStatusDto = describeRoute({
	description: "Get whether password-based login is enabled",
	tags: ["System"],
	operationId: "getPasswordLoginStatus",
	responses: {
		200: {
			description: "Password login status",
			content: {
				"application/json": {
					schema: resolver(passwordLoginStatusResponse),
				},
			},
		},
	},
});

export const setPasswordLoginStatusDto = describeRoute({
	description: "Enable or disable password-based login. Requires global admin role.",
	tags: ["System"],
	operationId: "setPasswordLoginStatus",
	responses: {
		200: {
			description: "Password login status updated",
			content: {
				"application/json": {
					schema: resolver(passwordLoginStatusResponse),
				},
			},
		},
	},
});

const devPanelResponse = z.object({
	enabled: z.boolean(),
});

export type DevPanelDto = z.infer<typeof devPanelResponse>;

export const getDevPanelDto = describeRoute({
	description: "Get the dev panel status",
	tags: ["System"],
	operationId: "getDevPanel",
	responses: {
		200: {
			description: "Dev panel status",
			content: {
				"application/json": {
					schema: resolver(devPanelResponse),
				},
			},
		},
	},
});
