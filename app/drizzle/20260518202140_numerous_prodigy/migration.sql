CREATE TABLE `repository_lock_waiters` (
	`id` text PRIMARY KEY,
	`repository_id` text NOT NULL,
	`type` text NOT NULL,
	`operation` text NOT NULL,
	`owner_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repository_locks` (
	`id` text PRIMARY KEY,
	`repository_id` text NOT NULL,
	`type` text NOT NULL,
	`operation` text NOT NULL,
	`owner_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `repository_lock_waiters_repository_id_idx` ON `repository_lock_waiters` (`repository_id`);--> statement-breakpoint
CREATE INDEX `repository_lock_waiters_expires_at_idx` ON `repository_lock_waiters` (`expires_at`);--> statement-breakpoint
CREATE INDEX `repository_lock_waiters_owner_id_idx` ON `repository_lock_waiters` (`owner_id`);--> statement-breakpoint
CREATE INDEX `repository_locks_repository_id_idx` ON `repository_locks` (`repository_id`);--> statement-breakpoint
CREATE INDEX `repository_locks_expires_at_idx` ON `repository_locks` (`expires_at`);--> statement-breakpoint
CREATE INDEX `repository_locks_owner_id_idx` ON `repository_locks` (`owner_id`);
