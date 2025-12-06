CREATE TABLE `secret_providers_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`custom_prefix` text,
	`config` text NOT NULL,
	`last_health_check` integer,
	`health_status` text DEFAULT 'unknown',
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secret_providers_table_name_unique` ON `secret_providers_table` (`name`);