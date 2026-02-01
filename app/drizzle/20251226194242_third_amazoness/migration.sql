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
	FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedules_table`("id", "short_id", "name", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "exclude_if_present", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "one_file_system", "sort_order", "created_at", "updated_at") SELECT "id", "short_id", "name", "volume_id", "repository_id", "enabled", "cron_expression", "retention_policy", "exclude_patterns", "exclude_if_present", "include_patterns", "last_backup_at", "last_backup_status", "last_backup_error", "next_backup_at", "one_file_system", "sort_order", "created_at", "updated_at" FROM `backup_schedules_table`;--> statement-breakpoint
DROP TABLE `backup_schedules_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedules_table` RENAME TO `backup_schedules_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `backup_schedules_table_short_id_unique` ON `backup_schedules_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_schedules_table_name_unique` ON `backup_schedules_table` (`name`);