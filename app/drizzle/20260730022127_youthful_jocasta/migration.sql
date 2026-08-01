ALTER TABLE `tasks` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `persistence_format_version` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `target_display_name` text;--> statement-breakpoint
CREATE INDEX `tasks_org_format_created_at_id_idx` ON `tasks` (`organization_id`,`persistence_format_version`,`created_at`,`id`);
