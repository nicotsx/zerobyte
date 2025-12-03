import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";

const secretsModeSchema = type("'exclude' | 'encrypted' | 'cleartext'");

const baseExportBodySchema = type({
	/** Include database IDs in export (default: true) */
	"includeIds?": "boolean",
	/** Include createdAt/updatedAt timestamps (default: true) */
	"includeTimestamps?": "boolean",
	/** Include runtime state like status, health checks (default: false) */
	"includeRuntimeState?": "boolean",
	/** How to handle secrets: exclude, encrypted, or cleartext (default: exclude) */
	"secretsMode?": secretsModeSchema,
	/** Password required for authentication */
	password: "string",
});

export const fullExportBodySchema = baseExportBodySchema.and(
	type({
		/** Include the recovery key (requires password) */
		"includeRecoveryKey?": "boolean",
		/** Include the admin password hash */
		"includePasswordHash?": "boolean",
	})
);

export const entityExportBodySchema = baseExportBodySchema.and(
	type({
		/** Filter by ID */
		"id?": "string | number",
		/** Filter by name */
		"name?": "string",
	})
);

export const backupScheduleExportBodySchema = baseExportBodySchema.and(
	type({
		/** Filter by ID */
		"id?": "number",
	})
);

export type FullExportBody = typeof fullExportBodySchema.infer;
export type EntityExportBody = typeof entityExportBodySchema.infer;
export type BackupScheduleExportBody = typeof backupScheduleExportBodySchema.infer;
export type SecretsMode = typeof secretsModeSchema.infer;

const exportResponseSchema = type({
	"version?": "number",
	"exportedAt?": "string",
	"volumes?": "unknown[]",
	"repositories?": "unknown[]",
	"backupSchedules?": "unknown[]",
	"notificationDestinations?": "unknown[]",
	"admin?": type({
		username: "string",
		"passwordHash?": "string",
		"recoveryKey?": "string",
	}).or("null"),
});

const volumesExportResponseSchema = type({
	volumes: "unknown[]",
});

const repositoriesExportResponseSchema = type({
	repositories: "unknown[]",
});

const notificationsExportResponseSchema = type({
	notificationDestinations: "unknown[]",
});

const backupSchedulesExportResponseSchema = type({
	backupSchedules: "unknown[]",
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
			description: "Password required for sensitive export options",
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

export const volumesExportDto = describeRoute({
	description: "Export volumes configuration",
	operationId: "exportVolumes",
	tags: ["Config Export"],
	responses: {
		200: {
			description: "Volumes configuration export",
			content: {
				"application/json": {
					schema: resolver(volumesExportResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid request",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		401: {
			description: "Password required for export",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		404: {
			description: "Volume not found",
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

export const repositoriesExportDto = describeRoute({
	description: "Export repositories configuration",
	operationId: "exportRepositories",
	tags: ["Config Export"],
	responses: {
		200: {
			description: "Repositories configuration export",
			content: {
				"application/json": {
					schema: resolver(repositoriesExportResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid request",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		401: {
			description: "Password required for sensitive export options",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		404: {
			description: "Repository not found",
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

export const notificationsExportDto = describeRoute({
	description: "Export notification destinations configuration",
	operationId: "exportNotificationDestinations",
	tags: ["Config Export"],
	responses: {
		200: {
			description: "Notification destinations configuration export",
			content: {
				"application/json": {
					schema: resolver(notificationsExportResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid request",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		401: {
			description: "Password required for sensitive export options",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		404: {
			description: "Notification destination not found",
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

export const backupSchedulesExportDto = describeRoute({
	description: "Export backup schedules configuration",
	operationId: "exportBackupSchedules",
	tags: ["Config Export"],
	responses: {
		200: {
			description: "Backup schedules configuration export",
			content: {
				"application/json": {
					schema: resolver(backupSchedulesExportResponseSchema),
				},
			},
		},
		400: {
			description: "Invalid request",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		401: {
			description: "Password required for export",
			content: {
				"application/json": {
					schema: resolver(errorResponseSchema),
				},
			},
		},
		404: {
			description: "Backup schedule not found",
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
