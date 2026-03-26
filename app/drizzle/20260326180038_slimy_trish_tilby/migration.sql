ALTER TABLE `users_table` ADD `date_format` text DEFAULT 'MM/DD/YYYY' NOT NULL;--> statement-breakpoint
ALTER TABLE `users_table` ADD `time_format` text DEFAULT '12h' NOT NULL;