import { relations, sql } from "drizzle-orm";
import { index, int, integer, sqliteTable, text, real, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
	CompressionMode,
	RepositoryBackend,
	repositoryConfigSchema,
	RepositoryStatus,
	BandwidthUnit,
} from "~/schemas/restic";
import type { BackendStatus, BackendType, volumeConfigSchema } from "~/schemas/volumes";
import type { NotificationType, notificationConfigSchema } from "~/schemas/notifications";

/**
 * Users Table
 */
export const usersTable = sqliteTable("users_table", {
	id: text("id").primaryKey(),
	username: text().notNull().unique(),
	passwordHash: text("password_hash"),
	hasDownloadedResticPassword: int("has_downloaded_restic_password", { mode: "boolean" }).notNull().default(false),
	createdAt: int("created_at", { mode: "timestamp_ms" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$onUpdate(() => new Date())
		.default(sql`(unixepoch() * 1000)`),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),
	image: text("image"),
	displayUsername: text("display_username"),
	twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" }).notNull().default(false),
	role: text("role").notNull().default("user"),
	banned: integer("banned", { mode: "boolean" }).notNull().default(false),
	banReason: text("ban_reason"),
	banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export type User = typeof usersTable.$inferSelect;
export const sessionsTable = sqliteTable(
	"sessions_table",
	{
		id: text().primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
		token: text("token").notNull().unique(),
		expiresAt: int("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: int("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$onUpdate(() => new Date())
			.default(sql`(unixepoch() * 1000)`),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		impersonatedBy: text("impersonated_by"),
		activeOrganizationId: text("active_organization_id"),
	},
	(table) => [index("sessionsTable_userId_idx").on(table.userId)],
);
export type Session = typeof sessionsTable.$inferSelect;

export const account = sqliteTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp_ms",
		}),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp_ms",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.$onUpdate(() => new Date())
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [index("verification_identifier_idx").on(table.identifier)],
);

export type OrganizationMetadata = {
	resticPassword: string;
};

export const organization = sqliteTable(
	"organization",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		slug: text("slug").notNull().unique(),
		logo: text("logo"),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		metadata: text("metadata", { mode: "json" }).$type<OrganizationMetadata>(),
	},
	(table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = sqliteTable(
	"member",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
		role: text("role").default("member").notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
	},
	(table) => [
		index("member_organizationId_idx").on(table.organizationId),
		index("member_userId_idx").on(table.userId),
		uniqueIndex("member_org_user_uidx").on(table.organizationId, table.userId),
	],
);

export const invitation = sqliteTable(
	"invitation",
	{
		id: text("id").primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		email: text("email").notNull(),
		role: text("role"),
		status: text("status").default("pending").notNull(),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
		inviterId: text("inviter_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
	},
	(table) => [
		index("invitation_organizationId_idx").on(table.organizationId),
		index("invitation_email_idx").on(table.email),
	],
);

/**
 * Volumes Table
 */
export const volumesTable = sqliteTable("volumes_table", {
	id: int().primaryKey({ autoIncrement: true }),
	shortId: text("short_id").notNull().unique(),
	name: text().notNull(),
	type: text().$type<BackendType>().notNull(),
	status: text().$type<BackendStatus>().notNull().default("unmounted"),
	lastError: text("last_error"),
	lastHealthCheck: integer("last_health_check", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	createdAt: integer("created_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: integer("updated_at", { mode: "number" })
		.notNull()
		.$onUpdate(() => Date.now())
		.default(sql`(unixepoch() * 1000)`),
	config: text("config", { mode: "json" }).$type<typeof volumeConfigSchema.inferOut>().notNull(),
	autoRemount: int("auto_remount", { mode: "boolean" }).notNull().default(true),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
}, (table) => [unique().on(table.name, table.organizationId)]);
export type Volume = typeof volumesTable.$inferSelect;
export type VolumeInsert = typeof volumesTable.$inferInsert;

/**
 * Repositories Table
 */
export const repositoriesTable = sqliteTable("repositories_table", {
	id: text().primaryKey(),
	shortId: text("short_id").notNull().unique(),
	name: text().notNull(),
	type: text().$type<RepositoryBackend>().notNull(),
	config: text("config", { mode: "json" }).$type<typeof repositoryConfigSchema.inferOut>().notNull(),
	compressionMode: text("compression_mode").$type<CompressionMode>().default("auto"),
	status: text().$type<RepositoryStatus>().default("unknown"),
	lastChecked: int("last_checked", { mode: "number" }),
	lastError: text("last_error"),
	uploadLimitEnabled: int("upload_limit_enabled", { mode: "boolean" }).notNull().default(false),
	uploadLimitValue: real("upload_limit_value").notNull().default(1),
	uploadLimitUnit: text("upload_limit_unit").$type<BandwidthUnit>().notNull().default("Mbps"),
	downloadLimitEnabled: int("download_limit_enabled", { mode: "boolean" }).notNull().default(false),
	downloadLimitValue: real("download_limit_value").notNull().default(1),
	downloadLimitUnit: text("download_limit_unit").$type<BandwidthUnit>().notNull().default("Mbps"),
	createdAt: int("created_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});
export type Repository = typeof repositoriesTable.$inferSelect;
export type RepositoryInsert = typeof repositoriesTable.$inferInsert;

/**
 * Backup Schedules Table
 */
export const backupSchedulesTable = sqliteTable("backup_schedules_table", {
	id: int().primaryKey({ autoIncrement: true }),
	shortId: text("short_id").notNull().unique(),
	name: text().notNull(),
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
	excludeIfPresent: text("exclude_if_present", { mode: "json" }).$type<string[]>().default([]),
	includePatterns: text("include_patterns", { mode: "json" }).$type<string[]>().default([]),
	lastBackupAt: int("last_backup_at", { mode: "number" }),
	lastBackupStatus: text("last_backup_status").$type<"success" | "error" | "in_progress" | "warning">(),
	lastBackupError: text("last_backup_error"),
	nextBackupAt: int("next_backup_at", { mode: "number" }),
	oneFileSystem: int("one_file_system", { mode: "boolean" }).notNull().default(false),
	sortOrder: int("sort_order", { mode: "number" }).notNull().default(0),
	createdAt: int("created_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});
export type BackupScheduleInsert = typeof backupSchedulesTable.$inferInsert;

export type BackupSchedule = typeof backupSchedulesTable.$inferSelect;

/**
 * Notification Destinations Table
 */
export const notificationDestinationsTable = sqliteTable("notification_destinations_table", {
	id: int().primaryKey({ autoIncrement: true }),
	name: text().notNull(),
	enabled: int("enabled", { mode: "boolean" }).notNull().default(true),
	type: text().$type<NotificationType>().notNull(),
	config: text("config", { mode: "json" }).$type<typeof notificationConfigSchema.inferOut>().notNull(),
	createdAt: int("created_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	organizationId: text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
});
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
		notifyOnWarning: int("notify_on_warning", { mode: "boolean" }).notNull().default(true),
		notifyOnFailure: int("notify_on_failure", { mode: "boolean" }).notNull().default(true),
		createdAt: int("created_at", { mode: "number" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [primaryKey({ columns: [table.scheduleId, table.destinationId] })],
);
export type BackupScheduleNotification = typeof backupScheduleNotificationsTable.$inferSelect;

/**
 * Backup Schedule Mirrors Junction Table (Many-to-Many)
 * Allows copying snapshots to secondary repositories after backup completes
 */
export const backupScheduleMirrorsTable = sqliteTable(
	"backup_schedule_mirrors_table",
	{
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
		createdAt: int("created_at", { mode: "number" })
			.notNull()
			.default(sql`(unixepoch() * 1000)`),
	},
	(table) => [unique().on(table.scheduleId, table.repositoryId)],
);

export type BackupScheduleMirror = typeof backupScheduleMirrorsTable.$inferSelect;

/**
 * App Metadata Table
 * Used for storing key-value pairs like migration checkpoints
 */
export const appMetadataTable = sqliteTable("app_metadata", {
	key: text().primaryKey(),
	value: text().notNull(),
	createdAt: int("created_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
	updatedAt: int("updated_at", { mode: "number" })
		.notNull()
		.default(sql`(unixepoch() * 1000)`),
});
export type AppMetadata = typeof appMetadataTable.$inferSelect;

export const twoFactor = sqliteTable(
	"two_factor",
	{
		id: text("id").primaryKey(),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => usersTable.id, { onDelete: "cascade" }),
	},
	(table) => [index("twoFactor_secret_idx").on(table.secret), index("twoFactor_userId_idx").on(table.userId)],
);

export const userRelations = relations(usersTable, ({ many }) => ({
	sessions: many(sessionsTable),
	accounts: many(account),
	members: many(member),
	invitations: many(invitation),
	twoFactors: many(twoFactor),
}));

export const sessionRelations = relations(sessionsTable, ({ one }) => ({
	user: one(usersTable, {
		fields: [sessionsTable.userId],
		references: [usersTable.id],
	}),
	activeOrganization: one(organization, {
		fields: [sessionsTable.activeOrganizationId],
		references: [organization.id],
	}),
}));

export const accountRelations = relations(account, ({ one }) => ({
	user: one(usersTable, {
		fields: [account.userId],
		references: [usersTable.id],
	}),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
	members: many(member),
	invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
	organization: one(organization, {
		fields: [member.organizationId],
		references: [organization.id],
	}),
	usersTable: one(usersTable, {
		fields: [member.userId],
		references: [usersTable.id],
	}),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
	organization: one(organization, {
		fields: [invitation.organizationId],
		references: [organization.id],
	}),
	usersTable: one(usersTable, {
		fields: [invitation.inviterId],
		references: [usersTable.id],
	}),
}));

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
	usersTable: one(usersTable, {
		fields: [twoFactor.userId],
		references: [usersTable.id],
	}),
}));

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

export const notificationDestinationRelations = relations(notificationDestinationsTable, ({ many }) => ({
	schedules: many(backupScheduleNotificationsTable),
}));

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
