CREATE TABLE IF NOT EXISTS `backup_schedules_table` (
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
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `backup_schedules_table_volume_id_unique` ON `backup_schedules_table` (`volume_id`);
