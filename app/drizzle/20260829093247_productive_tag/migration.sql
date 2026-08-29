PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_backup_schedules_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` text NOT NULL,
	`name` text NOT NULL,
	`volume_id` integer NOT NULL,
	`repository_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`cron_expression` text NOT NULL,
	`retention_policy` text,
	`exclude_patterns` text DEFAULT '[]',
	`exclude_if_present` text DEFAULT '[]',
	`include_paths` text DEFAULT '[]',
	`include_patterns` text DEFAULT '[]',
	`last_backup_at` integer,
	`last_backup_status` text,
	`last_backup_error` text,
	`next_backup_at` integer,
	`one_file_system` integer DEFAULT false NOT NULL,
	`custom_restic_params` text DEFAULT '[]',
	`compression_mode` text,
	`backup_webhooks` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`failure_retry_count` integer DEFAULT 0 NOT NULL,
	`max_retries` integer DEFAULT 2 NOT NULL,
	`retry_delay` integer DEFAULT 900000 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `backup_schedules_table_volume_id_volumes_table_id_fk` FOREIGN KEY (`volume_id`) REFERENCES `volumes_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedules_table_repository_id_repositories_table_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedules_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `backup_schedules_table_short_id_organization_id_unique` UNIQUE(`short_id`,`organization_id`)
);
--> statement-breakpoint
INSERT INTO `__new_backup_schedules_table`(`id`, `short_id`, `name`, `volume_id`, `repository_id`, `enabled`, `cron_expression`, `retention_policy`, `exclude_patterns`, `exclude_if_present`, `include_paths`, `include_patterns`, `last_backup_at`, `last_backup_status`, `last_backup_error`, `next_backup_at`, `one_file_system`, `custom_restic_params`, `compression_mode`, `backup_webhooks`, `sort_order`, `failure_retry_count`, `max_retries`, `retry_delay`, `created_at`, `updated_at`, `organization_id`) SELECT `id`, `short_id`, `name`, `volume_id`, `repository_id`, `enabled`, `cron_expression`, `retention_policy`, `exclude_patterns`, `exclude_if_present`, `include_paths`, `include_patterns`, `last_backup_at`, `last_backup_status`, `last_backup_error`, `next_backup_at`, `one_file_system`, `custom_restic_params`, `compression_mode`, `backup_webhooks`, `sort_order`, `failure_retry_count`, `max_retries`, `retry_delay`, `created_at`, `updated_at`, `organization_id` FROM `backup_schedules_table`;--> statement-breakpoint
DROP TABLE `backup_schedules_table`;--> statement-breakpoint
ALTER TABLE `__new_backup_schedules_table` RENAME TO `backup_schedules_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;