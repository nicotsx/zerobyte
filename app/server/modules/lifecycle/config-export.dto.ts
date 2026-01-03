import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

const secretsModeSchema = type("'exclude' | 'encrypted' | 'cleartext'");

export const fullExportBodySchema = type({
	/** Include metadata (IDs, timestamps, runtime state) in export (default: false) */
	"includeMetadata?": "boolean",
	/** How to handle secrets: exclude, encrypted, or cleartext (default: exclude) */
	"secretsMode?": secretsModeSchema,
	/** Password required for authentication */
	password: "string",
	/** Include the recovery key */
	"includeRecoveryKey?": "boolean",
	/** Include the user password hash */
	"includePasswordHash?": "boolean",
});

export type FullExportBody = typeof fullExportBodySchema.infer;
export type SecretsMode = typeof secretsModeSchema.infer;

const exportResponseSchema = type({
	version: "number",
	"exportedAt?": "string",
	"recoveryKey?": "string",
	"volumes?": "unknown[]",
	"repositories?": "unknown[]",
	"backupSchedules?": "unknown[]",
	"notificationDestinations?": "unknown[]",
	"users?": type({
		"id?": "number",
		username: "string",
		"passwordHash?": "string",
		"createdAt?": "number",
		"updatedAt?": "number",
		"hasDownloadedResticPassword?": "boolean",
	}).array(),
});

const errorResponseSchema = type({
	error: "string",
});

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
		401: {
			description: "Password required for export or authentication failed",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		500: {
			description: "Export failed",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
	},
});
