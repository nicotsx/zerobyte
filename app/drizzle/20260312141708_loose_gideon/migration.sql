ALTER TABLE `repositories_table` ADD `provisioning_id` text;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `provisioning_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_org_provisioning_id_uidx` ON `repositories_table` (`organization_id`,`provisioning_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_org_provisioning_id_uidx` ON `volumes_table` (`organization_id`,`provisioning_id`);