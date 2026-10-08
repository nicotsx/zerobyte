ALTER TABLE `volumes_table` ADD `source_kind` text DEFAULT 'managed' NOT NULL;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `trusted_root_id` text;--> statement-breakpoint
ALTER TABLE `volumes_table` ADD `relative_path` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_volumes_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`short_id` text NOT NULL UNIQUE,
	`provisioning_id` text,
	`name` text NOT NULL,
	`type` text,
	`status` text DEFAULT 'unmounted' NOT NULL,
	`last_error` text,
	`last_health_check` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`config` text,
	`auto_remount` integer DEFAULT true NOT NULL,
	`agent_id` text DEFAULT 'local' NOT NULL,
	`source_kind` text DEFAULT 'managed' NOT NULL,
	`trusted_root_id` text,
	`relative_path` text,
	`organization_id` text NOT NULL,
	CONSTRAINT `volumes_table_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `volumes_table_name_organization_id_unique` UNIQUE(`name`,`organization_id`),
	CONSTRAINT "volumes_table_source_fields_check" CHECK(("source_kind" = 'managed' AND "config" IS NOT NULL AND "type" IS NOT NULL AND "trusted_root_id" IS NULL AND "relative_path" IS NULL) OR ("source_kind" = 'agent-filesystem' AND "config" IS NULL AND "type" IS NULL AND "trusted_root_id" IS NOT NULL AND "relative_path" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_volumes_table`(`id`, `short_id`, `provisioning_id`, `name`, `type`, `status`, `last_error`, `last_health_check`, `created_at`, `updated_at`, `config`, `auto_remount`, `agent_id`, `organization_id`) SELECT `id`, `short_id`, `provisioning_id`, `name`, `type`, `status`, `last_error`, `last_health_check`, `created_at`, `updated_at`, `config`, `auto_remount`, `agent_id`, `organization_id` FROM `volumes_table`;--> statement-breakpoint
DROP TABLE `volumes_table`;--> statement-breakpoint
ALTER TABLE `__new_volumes_table` RENAME TO `volumes_table`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `volumes_table_agent_id_idx` ON `volumes_table` (`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `volumes_table_org_provisioning_id_uidx` ON `volumes_table` (`organization_id`,`provisioning_id`);