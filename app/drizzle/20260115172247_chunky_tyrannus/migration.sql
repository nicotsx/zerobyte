ALTER TABLE `repositories_table` ADD `upload_limit_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `upload_limit_value` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `upload_limit_unit` text DEFAULT 'Mbps' NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `download_limit_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `download_limit_value` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `download_limit_unit` text DEFAULT 'Mbps' NOT NULL;
