PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_repositories_table` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`compression_mode` text DEFAULT 'auto',
	`status` text DEFAULT 'unknown',
	`last_checked` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_repositories_table`("id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "created_at", "updated_at") SELECT "id", "short_id", "name", "type", "config", "compression_mode", "status", "last_checked", "last_error", "created_at", "updated_at" FROM `repositories_table`;--> statement-breakpoint
DROP TABLE `repositories_table`;--> statement-breakpoint
ALTER TABLE `__new_repositories_table` RENAME TO `repositories_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_short_id_unique` ON `repositories_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_name_unique` ON `repositories_table` (`name`);--> statement-breakpoint
CREATE TABLE `__new_volumes_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`short_id` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'unmounted' NOT NULL,
	`last_error` text,
	`last_health_check` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`config` text NOT NULL,
	`auto_remount` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_volumes_table`("id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount") SELECT "id", "short_id", "name", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount" FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_short_id_unique` ON `volumes_table` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_name_unique` ON `volumes_table` (`name`);