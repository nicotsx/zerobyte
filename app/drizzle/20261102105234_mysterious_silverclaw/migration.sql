ALTER TABLE `repositories_table` ADD `agent_id` text DEFAULT 'local' NOT NULL;--> statement-breakpoint
CREATE INDEX `repositories_table_agent_id_idx` ON `repositories_table` (`agent_id`);