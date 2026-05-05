CREATE TABLE `agents_table` (
	`id` text PRIMARY KEY,
	`organization_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`last_seen_at` integer,
	`last_ready_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_agents_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `agents_table_organization_id_idx` ON `agents_table` (`organization_id`);--> statement-breakpoint
CREATE INDEX `agents_table_status_idx` ON `agents_table` (`status`);