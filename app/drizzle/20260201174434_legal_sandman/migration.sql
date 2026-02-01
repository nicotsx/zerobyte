PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_schedule_mirrors_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`schedule_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_copy_at` integer,
	`last_copy_status` text,
	`last_copy_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `backup_schedule_mirrors_table_schedule_id_backup_schedules_table_id_fk` FOREIGN KEY (`schedule_id`) REFERENCES `backup_schedules_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedule_mirrors_table_repository_id_repositories_table_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedule_mirrors_table_schedule_id_repository_id_unique` UNIQUE(`schedule_id`,`repository_id`)
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedule_mirrors_table`(`id`, `schedule_id`, `repository_id`, `enabled`, `last_copy_at`, `last_copy_status`, `last_copy_error`, `created_at`) SELECT `id`, `schedule_id`, `repository_id`, `enabled`, `last_copy_at`, `last_copy_status`, `last_copy_error`, `created_at` FROM `backup_schedule_mirrors_table`;--> statement-breakpoint
DROP TABLE `backup_schedule_mirrors_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedule_mirrors_table` RENAME TO `backup_schedule_mirrors_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volumes_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'unmounted' NOT NULL,
	`last_error` text,
	`last_health_check` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`config` text NOT NULL,
	`auto_remount` integer DEFAULT true NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `volumes_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `volumes_table_name_organization_id_unique` UNIQUE(`name`,`organization_id`)
);
--> statement-breakpoint
INSERT INTO `__new_volumes_table`(`id`, `short_id`, `name`, `type`, `status`, `last_error`, `last_health_check`, `created_at`, `updated_at`, `config`, `auto_remount`, `organization_id`) SELECT `id`, `short_id`, `name`, `type`, `status`, `last_error`, `last_health_check`, `created_at`, `updated_at`, `config`, `auto_remount`, `organization_id` FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_schedules_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`volume_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cron_expression` text NOT NULL,
	`retention_policy` text,
	`exclude_patterns` text DEFAULT '[]',
	`exclude_if_present` text DEFAULT '[]',
	`include_patterns` text DEFAULT '[]',
	`last_backup_at` integer,
	`last_backup_status` text,
	`last_backup_error` text,
	`next_backup_at` integer,
	`one_file_system` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `backup_schedules_table_volume_id_volumes_table_id_fk` FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedules_table_repository_id_repositories_table_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedules_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedules_table`(`id`, `short_id`, `name`, `volume_id`, `repository_id`, `enabled`, `cron_expression`, `retention_policy`, `exclude_patterns`, `exclude_if_present`, `include_patterns`, `last_backup_at`, `last_backup_status`, `last_backup_error`, `next_backup_at`, `one_file_system`, `sort_order`, `created_at`, `updated_at`, `organization_id`) SELECT `id`, `short_id`, `name`, `volume_id`, `repository_id`, `enabled`, `cron_expression`, `retention_policy`, `exclude_patterns`, `exclude_if_present`, `include_patterns`, `last_backup_at`, `last_backup_status`, `last_backup_error`, `next_backup_at`, `one_file_system`, `sort_order`, `created_at`, `updated_at`, `organization_id` FROM `backup_schedules_table`;--> statement-breakpoint
DROP TABLE `backup_schedules_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedules_table` RENAME TO `backup_schedules_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_repositories_table` (
	`id` text PRIMARY KEY,
	`short_id` text NOT NULL UNIQUE,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`compression_mode` text DEFAULT 'auto',
	`status` text DEFAULT 'unknown',
	`last_checked` integer,
	`last_error` text,
	`doctor_result` text,
	`upload_limit_enabled` integer DEFAULT false NOT NULL,
	`upload_limit_value` real DEFAULT 1 NOT NULL,
	`upload_limit_unit` text DEFAULT 'Mbps' NOT NULL,
	`download_limit_enabled` integer DEFAULT false NOT NULL,
	`download_limit_value` real DEFAULT 1 NOT NULL,
	`download_limit_unit` text DEFAULT 'Mbps' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `repositories_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_repositories_table`(`id`, `short_id`, `name`, `type`, `config`, `compression_mode`, `status`, `last_checked`, `last_error`, `doctor_result`, `upload_limit_enabled`, `upload_limit_value`, `upload_limit_unit`, `download_limit_enabled`, `download_limit_value`, `download_limit_unit`, `created_at`, `updated_at`, `organization_id`) SELECT `id`, `short_id`, `name`, `type`, `config`, `compression_mode`, `status`, `last_checked`, `last_error`, `doctor_result`, `upload_limit_enabled`, `upload_limit_value`, `upload_limit_unit`, `download_limit_enabled`, `download_limit_value`, `download_limit_unit`, `created_at`, `updated_at`, `organization_id` FROM `repositories_table`;--> statement-breakpoint
DROP TABLE `repositories_table`;--> statement-breakpoint
ALTER TABLE `__new_repositories_table` RENAME TO `repositories_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sessions_table` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`token` text NOT NULL UNIQUE,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`impersonated_by` text,
	`active_organization_id` text,
	CONSTRAINT `sessions_table_user_id_users_table_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_sessions_table`(`id`, `user_id`, `token`, `expires_at`, `created_at`, `updated_at`, `ip_address`, `user_agent`, `impersonated_by`, `active_organization_id`) SELECT `id`, `user_id`, `token`, `expires_at`, `created_at`, `updated_at`, `ip_address`, `user_agent`, `impersonated_by`, `active_organization_id` FROM `sessions_table`;--> statement-breakpoint
DROP TABLE `sessions_table`;--> statement-breakpoint
ALTER TABLE `__new_sessions_table` RENAME TO `sessions_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users_table` (
	`id` text PRIMARY KEY,
	`username` text NOT NULL UNIQUE,
	`password_hash` text,
	`has_downloaded_restic_password` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL UNIQUE,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`display_username` text,
	`two_factor_enabled` integer DEFAULT false NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
INSERT INTO `__new_users_table`(`id`, `username`, `password_hash`, `has_downloaded_restic_password`, `created_at`, `updated_at`, `name`, `email`, `email_verified`, `image`, `display_username`, `two_factor_enabled`, `role`, `banned`, `ban_reason`, `ban_expires`) SELECT `id`, `username`, `password_hash`, `has_downloaded_restic_password`, `created_at`, `updated_at`, `name`, `email`, `email_verified`, `image`, `display_username`, `two_factor_enabled`, `role`, `banned`, `ban_reason`, `ban_expires` FROM `users_table`;--> statement-breakpoint
DROP TABLE `users_table`;--> statement-breakpoint
ALTER TABLE `__new_users_table` RENAME TO `users_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `backup_schedule_mirrors_table_schedule_id_repository_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `backup_schedules_table_short_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `organization_slug_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `repositories_table_short_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `sessions_table_token_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `users_table_username_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `users_table_email_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `volumes_table_short_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `volumes_table_name_organization_id_unique`;--> statement-breakpoint
CREATE INDEX `sessionsTable_userId_idx` ON `sessions_table` (`user_id`);