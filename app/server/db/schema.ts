import { relations, sql } from "drizzle-orm";
import { int, integer, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";
import type { CompressionMode, RepositoryBackend, repositoryConfigSchema, RepositoryStatus } from "~/schemas/restic";
import type { BackendStatus, BackendType, volumeConfigSchema } from "~/schemas/volumes";
import type { NotificationType, notificationConfigSchema } from "~/schemas/notifications";

/**
 * Volumes Table
 */
export const volumesTable = sqliteTable("volumes_table", {
	id: int().primaryKey({ autoIncrement: true }),
	shortId: text("short_id").notNull().unique(),
	name: text().notNull().unique(),
	type: text().$type<BackendType>().notNull(),
	status: text().$type<BackendStatus>().notNull().default("unmounted"),
	lastError: text("last_error"),
	lastHealthCheck: integer("last_health_check", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	createdAt: integer("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: integer("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	config: text("config", { mode: "json" }).$type<typeof volumeConfigSchema.inferOut>().notNull(),
	autoRemount: int("auto_remount", { mode: "boolean" }).notNull().default(true),
});
export type Volume = typeof volumesTable.$inferSelect;

/**
 * Users Table
 */
export const usersTable = sqliteTable("users_table", {
	id: int().primaryKey({ autoIncrement: true }),
	username: text().notNull().unique(),
	passwordHash: text("password_hash").notNull(),
	hasDownloadedResticPassword: int("has_downloaded_restic_password", { mode: "boolean" }).notNull().default(false),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type User = typeof usersTable.$inferSelect;
export const sessionsTable = sqliteTable("sessions_table", {
	id: text().primaryKey(),
	userId: int("user_id")
		.notNull()
		.references(() => usersTable.id, { onDelete: "cascade" }),
	expiresAt: int("expires_at", { mode: "number" }).notNull(),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type Session = typeof sessionsTable.$inferSelect;

/**
 * Repositories Table
 */
export const repositoriesTable = sqliteTable("repositories_table", {
	id: text().primaryKey(),
	shortId: text("short_id").notNull().unique(),
	name: text().notNull().unique(),
	type: text().$type<RepositoryBackend>().notNull(),
	config: text("config", { mode: "json" }).$type<typeof repositoryConfigSchema.inferOut>().notNull(),
	compressionMode: text("compression_mode").$type<CompressionMode>().default("auto"),
	status: text().$type<RepositoryStatus>().default("unknown"),
	lastChecked: int("last_checked", { mode: "number" }),
	lastError: text("last_error"),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type Repository = typeof repositoriesTable.$inferSelect;

/**
 * Backup Schedules Table
 */
export const backupSchedulesTable = sqliteTable("backup_schedules_table", {
	id: int().primaryKey({ autoIncrement: true }),
	volumeId: int("volume_id")
		.notNull()
		.references(() => volumesTable.id, { onDelete: "cascade" }),
	repositoryId: text("repository_id")
		.notNull()
		.references(() => repositoriesTable.id, { onDelete: "cascade" }),
	enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
	cronExpression: text("cron_expression").notNull(),
	retentionPolicy: text("retention_policy", { mode: "json" }).$type<{
		keepLast?: number;
		keepHourly?: number;
		keepDaily?: number;
		keepWeekly?: number;
		keepMonthly?: number;
		keepYearly?: number;
		keepWithinDuration?: string;
	}>(),
	excludePatterns: text("exclude_patterns", { mode: "json" }).$type<string[]>().default([]),
	includePatterns: text("include_patterns", { mode: "json" }).$type<string[]>().default([]),
	lastBackupAt: int("last_backup_at", { mode: "number" }),
	lastBackupStatus: text("last_backup_status").$type<"success" | "error" | "in_progress" | "warning">(),
	lastBackupError: text("last_backup_error"),
	nextBackupAt: int("next_backup_at", { mode: "number" }),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const backupScheduleRelations = relations(backupSchedulesTable, ({ one, many }) => ({
	volume: one(volumesTable, {
		fields: [backupSchedulesTable.volumeId],
		references: [volumesTable.id],
	}),
	repository: one(repositoriesTable, {
		fields: [backupSchedulesTable.repositoryId],
		references: [repositoriesTable.id],
	}),
	notifications: many(backupScheduleNotificationsTable),
	mirrors: many(backupScheduleMirrorsTable),
}));
export type BackupSchedule = typeof backupSchedulesTable.$inferSelect;

/**
 * Notification Destinations Table
 */
export const notificationDestinationsTable = sqliteTable("notification_destinations_table", {
	id: int().primaryKey({ autoIncrement: true }),
	name: text().notNull().unique(),
	enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
	type: text().$type<NotificationType>().notNull(),
	config: text("config", { mode: "json" }).$type<typeof notificationConfigSchema.inferOut>().notNull(),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export const notificationDestinationRelations = relations(notificationDestinationsTable, ({ many }) => ({
	schedules: many(backupScheduleNotificationsTable),
}));
export type NotificationDestination = typeof notificationDestinationsTable.$inferSelect;

/**
 * Backup Schedule Notifications Junction Table (Many-to-Many)
 */
export const backupScheduleNotificationsTable = sqliteTable(
	"backup_schedule_notifications_table",
	{
		scheduleId: int("schedule_id")
			.notNull()
			.references(() => backupSchedulesTable.id, { onDelete: "cascade" }),
		destinationId: int("destination_id")
			.notNull()
			.references(() => notificationDestinationsTable.id, { onDelete: "cascade" }),
		notifyOnStart: int("notify_on_start", { mode: "boolean" }).notNull().default(false),
		notifyOnSuccess: int("notify_on_success", { mode: "boolean" }).notNull().default(false),
		notifyOnFailure: int("notify_on_failure", { mode: "boolean" }).notNull().default(true),
		createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	},
	(table) => [primaryKey({ columns: [table.scheduleId, table.destinationId] })],
);
export const backupScheduleNotificationRelations = relations(backupScheduleNotificationsTable, ({ one }) => ({
	schedule: one(backupSchedulesTable, {
		fields: [backupScheduleNotificationsTable.scheduleId],
		references: [backupSchedulesTable.id],
	}),
	destination: one(notificationDestinationsTable, {
		fields: [backupScheduleNotificationsTable.destinationId],
		references: [notificationDestinationsTable.id],
	}),
}));
export type BackupScheduleNotification = typeof backupScheduleNotificationsTable.$inferSelect;

/**
 * Backup Schedule Mirrors Junction Table (Many-to-Many)
 * Allows copying snapshots to secondary repositories after backup completes
 */
export const backupScheduleMirrorsTable = sqliteTable("backup_schedule_mirrors_table", {
	id: int().primaryKey({ autoIncrement: true }),
	scheduleId: int("schedule_id")
		.notNull()
		.references(() => backupSchedulesTable.id, { onDelete: "cascade" }),
	repositoryId: text("repository_id")
		.notNull()
		.references(() => repositoriesTable.id, { onDelete: "cascade" }),
	enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
	lastCopyAt: int("last_copy_at", { mode: "number" }),
	lastCopyStatus: text("last_copy_status").$type<"success" | "error">(),
	lastCopyError: text("last_copy_error"),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const backupScheduleMirrorRelations = relations(backupScheduleMirrorsTable, ({ one }) => ({
	schedule: one(backupSchedulesTable, {
		fields: [backupScheduleMirrorsTable.scheduleId],
		references: [backupSchedulesTable.id],
	}),
	repository: one(repositoriesTable, {
		fields: [backupScheduleMirrorsTable.repositoryId],
		references: [repositoriesTable.id],
	}),
}));
export type BackupScheduleMirror = typeof backupScheduleMirrorsTable.$inferSelect;

/**
 * App Metadata Table
 * Used for storing key-value pairs like migration checkpoints
 */
export const appMetadataTable = sqliteTable("app_metadata", {
	key: text().primaryKey(),
	value: text().notNull(),
	createdAt: int("created_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type AppMetadata = typeof appMetadataTable.$inferSelect;
