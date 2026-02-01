CREATE TABLE `backup_schedule_notifications_table` (
	`schedule_id` integer NOT NULL,
	`destination_id` integer NOT NULL,
	`notify_on_start` integer DEFAULT false NOT NULL,
	`notify_on_success` integer DEFAULT false NOT NULL,
	`notify_on_failure` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`schedule_id`, `destination_id`),
	FOREIGN KEY (`schedule_id`) REFERENCES `backup_schedules_table`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `notification_destinations_table`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_destinations_table` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`type` text NOT NULL,
	`config` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_destinations_table_name_unique` ON `notification_destinations_table` (`name`);