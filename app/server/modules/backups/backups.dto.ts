import { z } from "zod";
import { describeRoute, resolver } from "hono-openapi";
import { volumeSchema } from "../volumes/volume.dto";
import { repositorySchema } from "../repositories/repositories.dto";
import { backupProgressEventSchema } from "~/schemas/events-dto";

const retentionPolicySchema = z.object({
	keepLast: z.number().optional(),
	keepHourly: z.number().optional(),
	keepDaily: z.number().optional(),
	keepWeekly: z.number().optional(),
	keepMonthly: z.number().optional(),
	keepYearly: z.number().optional(),
	keepWithinDuration: z.string().optional(),
});

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

const backupScheduleSchema = z.object({
	id: z.number(),
	shortId: z.string(),
	name: z.string(),
	volumeId: z.number(),
	repositoryId: z.string(),
	enabled: z.boolean(),
	cronExpression: z.string(),
	retentionPolicy: retentionPolicySchema.nullable(),
	excludePatterns: z.array(z.string()).nullable(),
	excludeIfPresent: z.array(z.string()).nullable(),
	includePaths: z.array(z.string()).nullable(),
	includePatterns: z.array(z.string()).nullable(),
	oneFileSystem: z.boolean(),
	customResticParams: z.array(z.string()).nullable(),
	lastBackupAt: z.number().nullable(),
	lastBackupStatus: z.enum(["success", "error", "in_progress", "warning"]).nullable(),
	lastBackupError: z.string().nullable(),
	nextBackupAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
	volume: volumeSchema,
	repository: repositorySchema,
});

const scheduleMirrorSchema = z.object({
	scheduleId: z.string(),
	repositoryId: z.string(),
	enabled: z.boolean(),
	lastCopyAt: z.number().nullable(),
	lastCopyStatus: z.enum(["success", "error", "in_progress"]).nullable(),
	lastCopyError: z.string().nullable(),
	createdAt: z.number(),
	repository: repositorySchema,
});

export type ScheduleMirrorDto = z.infer<typeof scheduleMirrorSchema>;

export const listBackupSchedulesResponse = backupScheduleSchema.array();

export type ListBackupSchedulesResponseDto = z.infer<typeof listBackupSchedulesResponse>;

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

export const getBackupScheduleResponse = backupScheduleSchema;

export type GetBackupScheduleDto = z.infer<typeof getBackupScheduleResponse>;

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

export const getBackupScheduleForVolumeResponse = backupScheduleSchema.nullable();

export type GetBackupScheduleForVolumeResponseDto = z.infer<typeof getBackupScheduleForVolumeResponse>;

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

export const createBackupScheduleBody = z.object({
	name: z.string().min(1).max(128),
	volumeId: z.union([z.string(), z.number()]),
	repositoryId: z.string(),
	enabled: z.boolean(),
	cronExpression: z.string(),
	retentionPolicy: retentionPolicySchema.optional(),
	excludePatterns: z.array(z.string()).optional(),
	excludeIfPresent: z.array(z.string()).optional(),
	includePaths: z.array(z.string()).optional(),
	includePatterns: z.array(z.string()).optional(),
	oneFileSystem: z.boolean().optional(),
	tags: z.array(z.string()).optional(),
	customResticParams: z.array(z.string()).optional(),
});

export type CreateBackupScheduleBody = z.infer<typeof createBackupScheduleBody>;

export const createBackupScheduleResponse = backupScheduleSchema.omit({ volume: true, repository: true });

export type CreateBackupScheduleDto = z.infer<typeof createBackupScheduleResponse>;

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

export const updateBackupScheduleBody = z.object({
	name: z.string().min(1).max(128).optional(),
	repositoryId: z.string(),
	enabled: z.boolean().optional(),
	cronExpression: z.string(),
	retentionPolicy: retentionPolicySchema.optional(),
	excludePatterns: z.array(z.string()).optional(),
	excludeIfPresent: z.array(z.string()).optional(),
	includePaths: z.array(z.string()).optional(),
	includePatterns: z.array(z.string()).optional(),
	oneFileSystem: z.boolean().optional(),
	tags: z.array(z.string()).optional(),
	customResticParams: z.array(z.string()).optional(),
});

export type UpdateBackupScheduleBody = z.infer<typeof updateBackupScheduleBody>;

export const updateBackupScheduleResponse = backupScheduleSchema.omit({ volume: true, repository: true });

export type UpdateBackupScheduleDto = z.infer<typeof updateBackupScheduleResponse>;

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

export const deleteBackupScheduleResponse = z.object({
	success: z.boolean(),
});

export type DeleteBackupScheduleDto = z.infer<typeof deleteBackupScheduleResponse>;

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

export const runBackupNowResponse = z.object({
	success: z.boolean(),
});

export type RunBackupNowDto = z.infer<typeof runBackupNowResponse>;

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

export const stopBackupResponse = z.object({
	success: z.boolean(),
});

export type StopBackupDto = z.infer<typeof stopBackupResponse>;

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

export const runForgetResponse = z.object({
	success: z.boolean(),
});

export type RunForgetDto = z.infer<typeof runForgetResponse>;

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
export type GetScheduleMirrorsDto = z.infer<typeof getScheduleMirrorsResponse>;

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

export const updateScheduleMirrorsBody = z.object({
	mirrors: z
		.object({
			repositoryId: z.string(),
			enabled: z.boolean(),
		})
		.array(),
});

export type UpdateScheduleMirrorsBody = z.infer<typeof updateScheduleMirrorsBody>;

export const updateScheduleMirrorsResponse = scheduleMirrorSchema.array();
export type UpdateScheduleMirrorsDto = z.infer<typeof updateScheduleMirrorsResponse>;

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

const mirrorCompatibilitySchema = z.object({
	repositoryId: z.string(),
	compatible: z.boolean(),
	reason: z.string().nullable(),
});

export const getMirrorCompatibilityResponse = mirrorCompatibilitySchema.array();
export type GetMirrorCompatibilityDto = z.infer<typeof getMirrorCompatibilityResponse>;

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

export const reorderBackupSchedulesBody = z.object({
	scheduleShortIds: z.array(z.string()),
});

export type ReorderBackupSchedulesBody = z.infer<typeof reorderBackupSchedulesBody>;

export const reorderBackupSchedulesResponse = z.object({
	success: z.boolean(),
});

export type ReorderBackupSchedulesDto = z.infer<typeof reorderBackupSchedulesResponse>;

export const reorderBackupSchedulesDto = describeRoute({
	description: "Reorder backup schedules by providing an array of schedule short IDs in the desired order",
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

const getBackupProgressResponse = backupProgressEventSchema.nullable();
export type GetBackupProgressDto = z.infer<typeof getBackupProgressResponse>;

export const getBackupProgressDto = describeRoute({
	description:
		"Get the last known progress for a currently running backup. Returns null if no progress has been reported yet.",
	tags: ["Backup Schedules"],
	operationId: "getBackupProgress",
	responses: {
		200: {
			description: "Current backup progress or null if not yet available",
			content: {
				"application/json": {
					schema: resolver(getBackupProgressResponse),
				},
			},
		},
	},
});
