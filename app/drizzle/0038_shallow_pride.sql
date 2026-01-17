DROP INDEX `volumes_table_name_unique`;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `organization_id` text REFERENCES organization(id);--> statement-breakpoint
ALTER TABLE `backup_schedules_table` ADD `organization_id` text REFERENCES organization(id);--> statement-breakpoint
ALTER TABLE `notification_destinations_table` ADD `organization_id` text REFERENCES organization(id);--> statement-breakpoint
ALTER TABLE `repositories_table` ADD `organization_id` text REFERENCES organization(id);
