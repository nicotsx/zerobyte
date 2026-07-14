ALTER TABLE `tasks` ADD `outcome` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `target_display_name` text;--> statement-breakpoint
CREATE INDEX `tasks_org_created_at_id_idx` ON `tasks` (`organization_id`,`created_at`,`id`);