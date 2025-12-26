ALTER TABLE `backup_schedules_table` ADD `short_id` text;--> statement-breakpoint
UPDATE `backup_schedules_table` SET `short_id` = lower(hex(randomblob(4))) WHERE `short_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `backup_schedules_table_short_id_unique` ON `backup_schedules_table` (`short_id`);
