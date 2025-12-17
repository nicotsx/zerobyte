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
