PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volumes_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
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
INSERT INTO `__new_volumes_table`("id", "name", "path", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount") SELECT "id", "name", "path", "type", "status", "last_error", "last_health_check", "created_at", "updated_at", "config", "auto_remount" FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_name_unique` ON `volumes_table` (`name`);