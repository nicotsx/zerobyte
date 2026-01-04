ALTER TABLE `users_table` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `users_table` ADD `totp_enabled` integer DEFAULT false NOT NULL;