ALTER TABLE `repositories_table` ADD `short_id` text;--> statement-breakpoint
UPDATE `repositories_table` SET `short_id` = lower(hex(randomblob(3))) WHERE `short_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_table_short_id_unique` ON `repositories_table` (`short_id`);--> statement-breakpoint

ALTER TABLE `volumes_table` ADD `short_id` text;--> statement-breakpoint
UPDATE `volumes_table` SET `short_id` = lower(hex(randomblob(3))) WHERE `short_id` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_short_id_unique` ON `volumes_table` (`short_id`);
