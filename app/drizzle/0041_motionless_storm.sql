DROP INDEX `backup_schedules_table_name_unique`;--> statement-breakpoint
DROP INDEX `notification_destinations_table_name_unique`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users_table` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`has_downloaded_restic_password` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
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
INSERT INTO `__new_users_table`("id", "username", "password_hash", "has_downloaded_restic_password", "created_at", "updated_at", "name", "email", "email_verified", "image", "display_username", "two_factor_enabled", "role", "banned", "ban_reason", "ban_expires") SELECT "id", "username", "password_hash", "has_downloaded_restic_password", "created_at", "updated_at", "name", "email", "email_verified", "image", "display_username", "two_factor_enabled", "role", "banned", "ban_reason", "ban_expires" FROM `users_table`;--> statement-breakpoint
DROP TABLE `users_table`;--> statement-breakpoint
ALTER TABLE `__new_users_table` RENAME TO `users_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_username_unique` ON `users_table` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_table_email_unique` ON `users_table` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_org_user_uidx` ON `member` (`organization_id`,`user_id`);