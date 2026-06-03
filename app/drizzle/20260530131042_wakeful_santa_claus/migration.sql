CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`target_agent_id` text,
	`input` text NOT NULL,
	`progress` text,
	`result` text,
	`error` text,
	`cancellation_requested` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finished_at` integer,
	CONSTRAINT `fk_tasks_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `tasks_org_kind_resource_status_idx` ON `tasks` (`organization_id`,`kind`,`resource_type`,`resource_id`,`status`);--> statement-breakpoint
CREATE INDEX `tasks_org_status_updated_at_idx` ON `tasks` (`organization_id`,`status`,`updated_at`);