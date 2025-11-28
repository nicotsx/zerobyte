DROP TABLE IF EXISTS `backup_schedule_mirrors_table`;--> statement-breakpoint
CREATE TABLE `backup_schedule_mirrors_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schedule_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_copy_at` integer,
	`last_copy_status` text,
	`last_copy_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `backup_schedules_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_metadata`("key", "value", "created_at", "updated_at") SELECT "key", "value", "created_at", "updated_at" FROM `app_metadata`;--> statement-breakpoint
DROP TABLE `app_metadata`;--> statement-breakpoint
ALTER TABLE `__new_app_metadata` RENAME TO `app_metadata`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_backup_schedule_notifications_table` (
	`schedule_id` integer NOT NULL,
	`destination_id` integer NOT NULL,
	`notify_on_start` integer DEFAULT false NOT NULL,
	`notify_on_success` integer DEFAULT false NOT NULL,
	`notify_on_failure` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`schedule_id`, `destination_id`),
	FOREIGN KEY (`schedule_id`) REFERENCES `backup_schedules_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `notification_destinations_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedule_notifications_table`("schedule_id", "destination_id", "notify_on_start", "notify_on_success", "notify_on_failure", "created_at") SELECT "schedule_id", "destination_id", "notify_on_start", "notify_on_success", "notify_on_failure", "created_at" FROM `backup_schedule_notifications_table`;--> statement-breakpoint
DROP TABLE `backup_schedule_notifications_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedule_notifications_table` RENAME TO `backup_schedule_notifications_table`;--> statement-breakpoint
CREATE TABLE `__new_backup_schedules_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`volume_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cron_expression` text NOT NULL,
	`retention_policy` text,
	`exclude_patterns` text DEFAULT '[]',
	`include_patterns` text DEFAULT '[]',
	`last_backup_at` integer,
	`last_backup_status` text,
	`last_backup_error` text,
	`next_backup_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedules_table`("id", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "created_at", "updated_at") SELECT "id", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "created_at", "updated_at" FROM `backup_schedules_table`;--> statement-breakpoint
DROP TABLE `backup_schedules_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedules_table` RENAME TO `backup_schedules_table`;--> statement-breakpoint
CREATE TABLE `__new_notification_destinations_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_notification_destinations_table`("id", "name", "enabled", "type", "config", "created_at", "updated_at") SELECT "id", "name", "enabled", "type", "config", "created_at", "updated_at" FROM `notification_destinations_table`;--> statement-breakpoint
DROP TABLE `notification_destinations_table`;--> statement-breakpoint
ALTER TABLE `__new_notification_destinations_table` RENAME TO `notification_destinations_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destinations_table_name_unique` ON `notification_destinations_table` (`name`);--> statement-breakpoint
CREATE TABLE `__new_repositories_table` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`compression_mode` text DEFAULT 'auto',
	`status` text DEFAULT 'unknown',
	`last_checked` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_repositories_table`("id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "created_at", "updated_at") SELECT "id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "created_at", "updated_at" FROM `repositories_table`;--> statement-breakpoint
DROP TABLE `repositories_table`;--> statement-breakpoint
ALTER TABLE `__new_repositories_table` RENAME TO `repositories_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_short_id_unique` ON `repositories_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_name_unique` ON `repositories_table` (`name`);--> statement-breakpoint
CREATE TABLE `__new_sessions_table` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_sessions_table`("id", "user_id", "expires_at", "created_at") SELECT "id", "user_id", "expires_at", "created_at" FROM `sessions_table`;--> statement-breakpoint
DROP TABLE `sessions_table`;--> statement-breakpoint
ALTER TABLE `__new_sessions_table` RENAME TO `sessions_table`;--> statement-breakpoint
CREATE TABLE `__new_users_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`has_downloaded_restic_password` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_users_table`("id", "username", "password_hash", "has_downloaded_restic_password", "created_at", "updated_at") SELECT "id", "username", "password_hash", "has_downloaded_restic_password", "created_at", "updated_at" FROM `users_table`;--> statement-breakpoint
DROP TABLE `users_table`;--> statement-breakpoint
ALTER TABLE `__new_users_table` RENAME TO `users_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_username_unique` ON `users_table` (`username`);--> statement-breakpoint
CREATE TABLE `__new_volumes_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`short_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'unmounted' NOT NULL,
	`last_error` text,
	`last_health_check` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`config` text NOT NULL,
	`auto_remount` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_volumes_table`("id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount") SELECT "id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount" FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_short_id_unique` ON `volumes_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_name_unique` ON `volumes_table` (`name`);
