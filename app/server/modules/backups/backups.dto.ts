import { type } from "arktype";
import { describeRoute, resolver } from "hono-openapi";
import { volumeSchema } from "../volumes/volume.dto";
import { repositorySchema } from "../repositories/repositories.dto";

export const retentionPolicySchema = type({
	keepLast: "number?",
	keepHourly: "number?",
	keepDaily: "number?",
	keepWeekly: "number?",
	keepMonthly: "number?",
	keepYearly: "number?",
	keepWithinDuration: "string?",
});

export type RetentionPolicy = typeof retentionPolicySchema.infer;

const backupScheduleSchema = type({
	id: "number",
	shortId: "string",
	name: "string",
	volumeId: "number",
	repositoryId: "string",
	enabled: "boolean",
	cronExpression: "string",
	retentionPolicy: retentionPolicySchema.or("null"),
	excludePatterns: "string[] | null",
	excludeIfPresent: "string[] | null",
	includePatterns: "string[] | null",
	oneFileSystem: "boolean",
	lastBackupAt: "number | null",
	lastBackupStatus: "'success' | 'error' | 'in_progress' | 'warning' | null",
	lastBackupError: "string | null",
	nextBackupAt: "number | null",
	createdAt: "number",
	updatedAt: "number",
}).and(
	type({
		volume: volumeSchema,
		repository: repositorySchema,
	}),
);

const scheduleMirrorSchema = type({
	scheduleId: "number",
	repositoryId: "string",
	enabled: "boolean",
	lastCopyAt: "number | null",
	lastCopyStatus: "'success' | 'error' | null",
	lastCopyError: "string | null",
	createdAt: "number",
	repository: repositorySchema,
});

export type ScheduleMirrorDto = typeof scheduleMirrorSchema.infer;

/**
 * List all backup schedules
 */
export const listBackupSchedulesResponse = backupScheduleSchema.array();

export type ListBackupSchedulesResponseDto = typeof listBackupSchedulesResponse.infer;

export const listBackupSchedulesDto = describeRoute({
	description: "List all backup schedules",
	tags: ["Backups"],
	operationId: "listBackupSchedules",
	responses: {
		200: {
			description: "List of backup schedules",
			content: {
				"application/json": {
					schema: resolver(listBackupSchedulesResponse),
				},
			},
		},
	},
});

/**
 * Get a single backup schedule
 */
export const getBackupScheduleResponse = backupScheduleSchema;

export type GetBackupScheduleDto = typeof getBackupScheduleResponse.infer;

export const getBackupScheduleDto = describeRoute({
	description: "Get a backup schedule by ID",
	tags: ["Backups"],
	operationId: "getBackupSchedule",
	responses: {
		200: {
			description: "Backup schedule details",
			content: {
				"application/json": {
					schema: resolver(getBackupScheduleResponse),
				},
			},
		},
	},
});

export const getBackupScheduleForVolumeResponse = backupScheduleSchema.or("null");

export type GetBackupScheduleForVolumeResponseDto = typeof getBackupScheduleForVolumeResponse.infer;

export const getBackupScheduleForVolumeDto = describeRoute({
	description: "Get a backup schedule for a specific volume",
	tags: ["Backups"],
	operationId: "getBackupScheduleForVolume",
	responses: {
		200: {
			description: "Backup schedule details for the volume",
			content: {
				"application/json": {
					schema: resolver(getBackupScheduleForVolumeResponse),
				},
			},
		},
	},
});

/**
 * Create a new backup schedule
 */
export const createBackupScheduleBody = type({
	name: "1 <= string <= 32",
	volumeId: "number",
	repositoryId: "string",
	enabled: "boolean",
	cronExpression: "string",
	retentionPolicy: retentionPolicySchema.optional(),
	excludePatterns: "string[]?",
	excludeIfPresent: "string[]?",
	includePatterns: "string[]?",
	oneFileSystem: "boolean?",
	tags: "string[]?",
});

export type CreateBackupScheduleBody = typeof createBackupScheduleBody.infer;

export const createBackupScheduleResponse = backupScheduleSchema.omit("volume", "repository");

export type CreateBackupScheduleDto = typeof createBackupScheduleResponse.infer;

export const createBackupScheduleDto = describeRoute({
	description: "Create a new backup schedule for a volume",
	operationId: "createBackupSchedule",
	tags: ["Backups"],
	responses: {
		201: {
			description: "Backup schedule created successfully",
			content: {
				"application/json": {
					schema: resolver(createBackupScheduleResponse),
				},
			},
		},
	},
});

/**
 * Update a backup schedule
 */
export const updateBackupScheduleBody = type({
	name: "(1 <= string <= 32)?",
	repositoryId: "string",
	enabled: "boolean?",
	cronExpression: "string",
	retentionPolicy: retentionPolicySchema.optional(),
	excludePatterns: "string[]?",
	excludeIfPresent: "string[]?",
	includePatterns: "string[]?",
	oneFileSystem: "boolean?",
	tags: "string[]?",
});

export type UpdateBackupScheduleBody = typeof updateBackupScheduleBody.infer;

export const updateBackupScheduleResponse = backupScheduleSchema.omit("volume", "repository");

export type UpdateBackupScheduleDto = typeof updateBackupScheduleResponse.infer;

export const updateBackupScheduleDto = describeRoute({
	description: "Update a backup schedule",
	operationId: "updateBackupSchedule",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Backup schedule updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateBackupScheduleResponse),
				},
			},
		},
	},
});

/**
 * Delete a backup schedule
 */
export const deleteBackupScheduleResponse = type({
	success: "boolean",
});

export type DeleteBackupScheduleDto = typeof deleteBackupScheduleResponse.infer;

export const deleteBackupScheduleDto = describeRoute({
	description: "Delete a backup schedule",
	operationId: "deleteBackupSchedule",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Backup schedule deleted successfully",
			content: {
				"application/json": {
					schema: resolver(deleteBackupScheduleResponse),
				},
			},
		},
	},
});

/**
 * Run a backup immediately
 */
export const runBackupNowResponse = type({
	success: "boolean",
});

export type RunBackupNowDto = typeof runBackupNowResponse.infer;

export const runBackupNowDto = describeRoute({
	description: "Trigger a backup immediately for a schedule",
	operationId: "runBackupNow",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Backup started successfully",
			content: {
				"application/json": {
					schema: resolver(runBackupNowResponse),
				},
			},
		},
	},
});

/**
 * Stop a running backup
 */
export const stopBackupResponse = type({
	success: "boolean",
});

export type StopBackupDto = typeof stopBackupResponse.infer;

export const stopBackupDto = describeRoute({
	description: "Stop a backup that is currently in progress",
	operationId: "stopBackup",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Backup stopped successfully",
			content: {
				"application/json": {
					schema: resolver(stopBackupResponse),
				},
			},
		},
		409: {
			description: "No backup is currently running for this schedule",
		},
	},
});

/**
 * Run retention policy (forget) manually
 */
export const runForgetResponse = type({
	success: "boolean",
});

export type RunForgetDto = typeof runForgetResponse.infer;

export const runForgetDto = describeRoute({
	description: "Manually apply retention policy to clean up old snapshots",
	operationId: "runForget",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Retention policy applied successfully",
			content: {
				"application/json": {
					schema: resolver(runForgetResponse),
				},
			},
		},
	},
});

export const getScheduleMirrorsResponse = scheduleMirrorSchema.array();
export type GetScheduleMirrorsDto = typeof getScheduleMirrorsResponse.infer;

export const getScheduleMirrorsDto = describeRoute({
	description: "Get mirror repository assignments for a backup schedule",
	operationId: "getScheduleMirrors",
	tags: ["Backups"],
	responses: {
		200: {
			description: "List of mirror repository assignments for the schedule",
			content: {
				"application/json": {
					schema: resolver(getScheduleMirrorsResponse),
				},
			},
		},
	},
});

export const updateScheduleMirrorsBody = type({
	mirrors: type({
		repositoryId: "string",
		enabled: "boolean",
	}).array(),
});

export type UpdateScheduleMirrorsBody = typeof updateScheduleMirrorsBody.infer;

export const updateScheduleMirrorsResponse = scheduleMirrorSchema.array();
export type UpdateScheduleMirrorsDto = typeof updateScheduleMirrorsResponse.infer;

export const updateScheduleMirrorsDto = describeRoute({
	description: "Update mirror repository assignments for a backup schedule",
	operationId: "updateScheduleMirrors",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Mirror assignments updated successfully",
			content: {
				"application/json": {
					schema: resolver(updateScheduleMirrorsResponse),
				},
			},
		},
	},
});

const mirrorCompatibilitySchema = type({
	repositoryId: "string",
	compatible: "boolean",
	reason: "string | null",
});

export const getMirrorCompatibilityResponse = mirrorCompatibilitySchema.array();
export type GetMirrorCompatibilityDto = typeof getMirrorCompatibilityResponse.infer;

export const getMirrorCompatibilityDto = describeRoute({
	description: "Get mirror compatibility info for all repositories relative to a backup schedule's primary repository",
	operationId: "getMirrorCompatibility",
	tags: ["Backups"],
	responses: {
		200: {
			description: "List of repositories with their mirror compatibility status",
			content: {
				"application/json": {
					schema: resolver(getMirrorCompatibilityResponse),
				},
			},
		},
	},
});

/**
 * Reorder backup schedules
 */
export const reorderBackupSchedulesBody = type({
	scheduleIds: "number[]",
});

export type ReorderBackupSchedulesBody = typeof reorderBackupSchedulesBody.infer;

export const reorderBackupSchedulesResponse = type({
	success: "boolean",
});

export type ReorderBackupSchedulesDto = typeof reorderBackupSchedulesResponse.infer;

export const reorderBackupSchedulesDto = describeRoute({
	description: "Reorder backup schedules by providing an array of schedule IDs in the desired order",
	operationId: "reorderBackupSchedules",
	tags: ["Backups"],
	responses: {
		200: {
			description: "Backup schedules reordered successfully",
			content: {
				"application/json": {
					schema: resolver(reorderBackupSchedulesResponse),
				},
			},
		},
	},
});
