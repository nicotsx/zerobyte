ALTER TABLE `notification_destinations_table` ADD `status` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_destinations_table` ADD `last_checked` integer;--> statement-breakpoint
ALTER TABLE `notification_destinations_table` ADD `last_error` text;