ALTER TABLE `volumes_table` ADD `path` text NOT NULL;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `created_at` integer DEFAULT (current_timestamp) NOT NULL;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `updated_at` integer DEFAULT (current_timestamp) NOT NULL;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `config` text NOT NULL;