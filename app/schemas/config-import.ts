import { type } from "arktype";
import { volumeConfigSchema } from "./volumes";
import { repositoryConfigSchema } from "./restic";
import { notificationConfigSchema } from "./notifications";
import { retentionPolicySchema } from "../server/modules/backups/backups.dto";

/**
 * ArkType schemas for validating config import JSON files.
 * These provide runtime validation with detailed error messages.
 */

// Short ID format: 8 character base64url string
const shortIdSchema = type(/^[A-Za-z0-9_-]{8}$/);

// Volume entry schema for import
export const volumeImportSchema = type({
	name: "string>=1",
	shortId: shortIdSchema.optional(),
	autoRemount: "boolean?",
	config: volumeConfigSchema,
}).onUndeclaredKey("delete");

// Repository entry schema for import
export const repositoryImportSchema = type({
	name: "string>=1",
	shortId: shortIdSchema.optional(),
	compressionMode: type("'auto' | 'off' | 'max'").optional(),
	config: repositoryConfigSchema,
}).onUndeclaredKey("delete");

// Notification destination entry schema for import
export const notificationDestinationImportSchema = type({
	name: "string>=1",
	enabled: "boolean?",
	config: notificationConfigSchema,
}).onUndeclaredKey("delete");

// Schedule notification assignment (either string name or object with settings)
const scheduleNotificationObjectSchema = type({
	name: "string>=1",
	notifyOnStart: "boolean?",
	notifyOnSuccess: "boolean?",
	notifyOnWarning: "boolean?",
	notifyOnFailure: "boolean?",
}).onUndeclaredKey("delete");

export const scheduleNotificationAssignmentSchema = type("string>=1").or(scheduleNotificationObjectSchema);

// Schedule mirror assignment
export const scheduleMirrorSchema = type({
	repository: "string>=1",
	enabled: "boolean?",
}).onUndeclaredKey("delete");

// Array types for complex schemas
const scheduleNotificationsArray = scheduleNotificationAssignmentSchema.array();
const scheduleMirrorsArray = scheduleMirrorSchema.array();

// Backup schedule entry schema for import
export const backupScheduleImportSchema = type({
	name: "string?",
	shortId: shortIdSchema.optional(),
	volume: "string>=1",
	repository: "string>=1",
	cronExpression: "string",
	enabled: "boolean?",
	retentionPolicy: retentionPolicySchema.or("null").optional(),
	excludePatterns: "string[]?",
	excludeIfPresent: "string[]?",
	includePatterns: "string[]?",
	oneFileSystem: "boolean?",
	notifications: scheduleNotificationsArray.optional(),
	mirrors: scheduleMirrorsArray.optional(),
}).onUndeclaredKey("delete");

// User entry schema for import
export const userImportSchema = type({
	username: "string>=1",
	password: "(string>=1)?",
	passwordHash: "(string>=1)?",
	hasDownloadedResticPassword: "boolean?",
}).onUndeclaredKey("delete");

// Recovery key format: 64-character hex string
const recoveryKeySchema = type(/^[a-fA-F0-9]{64}$/);

// Array types for root config
const volumesArray = volumeImportSchema.array();
const repositoriesArray = repositoryImportSchema.array();
const backupSchedulesArray = backupScheduleImportSchema.array();
const notificationDestinationsArray = notificationDestinationImportSchema.array();
const usersArray = userImportSchema.array();

// Root config schema
export const importConfigSchema = type({
	volumes: volumesArray.optional(),
	repositories: repositoriesArray.optional(),
	backupSchedules: backupSchedulesArray.optional(),
	notificationDestinations: notificationDestinationsArray.optional(),
	users: usersArray.optional(),
	recoveryKey: recoveryKeySchema.optional(),
}).onUndeclaredKey("delete");

// Type exports
export type VolumeImport = typeof volumeImportSchema.infer;
export type RepositoryImport = typeof repositoryImportSchema.infer;
export type NotificationDestinationImport = typeof notificationDestinationImportSchema.infer;
export type BackupScheduleImport = typeof backupScheduleImportSchema.infer;
export type UserImport = typeof userImportSchema.infer;
export type ImportConfig = typeof importConfigSchema.infer;
export type ScheduleNotificationAssignment = typeof scheduleNotificationAssignmentSchema.infer;
export type ScheduleMirror = typeof scheduleMirrorSchema.infer;
// RetentionPolicy type is re-exported from backups.dto.ts
export type { RetentionPolicy } from "../server/modules/backups/backups.dto";
