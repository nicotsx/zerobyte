-- Add short_id column to repositories_table (nullable initially)
ALTER TABLE `repositories_table` ADD `short_id` text;--> statement-breakpoint

-- Populate short_id for existing repositories using random hex string
UPDATE `repositories_table` SET `short_id` = lower(hex(randomblob(3))) WHERE `short_id` IS NULL;--> statement-breakpoint

-- Create unique index on repositories short_id
CREATE UNIQUE INDEX `repositories_table_short_id_unique` ON `repositories_table` (`short_id`);--> statement-breakpoint

-- Add short_id column to volumes_table (nullable initially)
ALTER TABLE `volumes_table` ADD `short_id` text;--> statement-breakpoint

-- Populate short_id for existing volumes using random hex string
UPDATE `volumes_table` SET `short_id` = lower(hex(randomblob(3))) WHERE `short_id` IS NULL;--> statement-breakpoint

-- Create unique index on volumes short_id
CREATE UNIQUE INDEX `volumes_table_short_id_unique` ON `volumes_table` (`short_id`);