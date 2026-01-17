PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_schedules_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`short_id` text NOT NULL,
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
	FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedules_table`("id", "short_id", "name", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "exclude_if_present", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "one_file_system", "sort_order", "created_at", "updated_at", "organization_id") SELECT "id", "short_id", "name", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "exclude_if_present", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "one_file_system", "sort_order", "created_at", "updated_at", "organization_id" FROM `backup_schedules_table`;--> statement-breakpoint
DROP TABLE `backup_schedules_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedules_table` RENAME TO `backup_schedules_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `backup_schedules_table_short_id_unique` ON `backup_schedules_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_schedules_table_name_unique` ON `backup_schedules_table` (`name`);--> statement-breakpoint
CREATE TABLE `__new_notification_destinations_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_notification_destinations_table`("id", "name", "enabled", "type", "config", "created_at", "updated_at", "organization_id") SELECT "id", "name", "enabled", "type", "config", "created_at", "updated_at", "organization_id" FROM `notification_destinations_table`;--> statement-breakpoint
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
	`upload_limit_enabled` integer DEFAULT false NOT NULL,
	`upload_limit_value` real DEFAULT 1 NOT NULL,
	`upload_limit_unit` text DEFAULT 'Mbps' NOT NULL,
	`download_limit_enabled` integer DEFAULT false NOT NULL,
	`download_limit_value` real DEFAULT 1 NOT NULL,
	`download_limit_unit` text DEFAULT 'Mbps' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_repositories_table`("id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "upload_limit_enabled", "upload_limit_value", "upload_limit_unit", "download_limit_enabled", "download_limit_value", "download_limit_unit", "created_at", "updated_at", "organization_id") SELECT "id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "upload_limit_enabled", "upload_limit_value", "upload_limit_unit", "download_limit_enabled", "download_limit_value", "download_limit_unit", "created_at", "updated_at", "organization_id" FROM `repositories_table`;--> statement-breakpoint
DROP TABLE `repositories_table`;--> statement-breakpoint
ALTER TABLE `__new_repositories_table` RENAME TO `repositories_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_short_id_unique` ON `repositories_table` (`short_id`);--> statement-breakpoint
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
	`auto_remount` integer DEFAULT true NOT NULL,
	`organization_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_volumes_table`("id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount", "organization_id") SELECT "id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount", "organization_id" FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_short_id_unique` ON `volumes_table` (`short_id`);