CREATE TABLE `snapshot_usage_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`repository_id` text NOT NULL,
	`snapshot_id` text NOT NULL,
	`schedule_short_id` text,
	`format_version` integer NOT NULL,
	`source` text NOT NULL,
	`total_size` integer NOT NULL,
	`file_count` integer NOT NULL,
	`dir_count` integer NOT NULL,
	`scanned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`tree` blob NOT NULL,
	`organization_id` text NOT NULL,
	CONSTRAINT `fk_snapshot_usage_scans_repository_id_repositories_table_id_fk` FOREIGN KEY (`repository_id`) REFERENCES `repositories_table`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_snapshot_usage_scans_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `snapshot_usage_scans_repo_snapshot_uidx` ON `snapshot_usage_scans` (`repository_id`,`snapshot_id`);--> statement-breakpoint
CREATE INDEX `snapshot_usage_scans_schedule_scanned_at_idx` ON `snapshot_usage_scans` (`organization_id`,`schedule_short_id`,`scanned_at`);