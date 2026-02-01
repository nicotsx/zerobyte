CREATE TABLE `repositories_table` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`backend` text NOT NULL,
	`config` text NOT NULL,
	`compression_mode` text DEFAULT 'auto',
	`status` text DEFAULT 'unknown',
	`last_checked` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_name_unique` ON `repositories_table` (`name`);--> statement-breakpoint
ALTER TABLE `volumes_table` DROP COLUMN `path`;