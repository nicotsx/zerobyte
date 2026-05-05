ALTER TABLE `volumes_table` ADD `agent_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `volumes_table_agent_id_idx` ON `volumes_table` (`agent_id`);
