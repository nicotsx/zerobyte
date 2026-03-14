CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_by` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_agent_tokens_agent_id_agents_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agent_tokens_created_by_users_table_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users_table`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`organization_id` text NOT NULL,
	`created_by` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_agents_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agents_created_by_users_table_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `agents_name_org_uidx` UNIQUE(`name`,`organization_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_token_hash_uidx` ON `agent_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_agent_id_idx` ON `agent_tokens` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agents_organization_id_idx` ON `agents` (`organization_id`);