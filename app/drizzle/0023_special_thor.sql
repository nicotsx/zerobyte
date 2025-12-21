ALTER TABLE `backup_schedules_table` ADD `one_file_system` integer DEFAULT false NOT NULL;
UPDATE `backup_schedules_table` SET `one_file_system` = true;