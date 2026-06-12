PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_apikey` (
	`id` text PRIMARY KEY,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT false,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`permissions` text,
	`metadata` text,
	CONSTRAINT `fk_apikey_reference_id_users_table_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `users_table`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_apikey`(`id`, `config_id`, `name`, `start`, `reference_id`, `prefix`, `key`, `refill_interval`, `refill_amount`, `last_refill_at`, `enabled`, `rate_limit_enabled`, `rate_limit_time_window`, `rate_limit_max`, `request_count`, `remaining`, `last_request`, `expires_at`, `created_at`, `updated_at`, `permissions`, `metadata`) SELECT `id`, `config_id`, `name`, `start`, `reference_id`, `prefix`, `key`, `refill_interval`, `refill_amount`, `last_refill_at`, `enabled`, `rate_limit_enabled`, `rate_limit_time_window`, `rate_limit_max`, `request_count`, `remaining`, `last_request`, `expires_at`, `created_at`, `updated_at`, `permissions`, `metadata` FROM `apikey`;--> statement-breakpoint
DROP TABLE `apikey`;--> statement-breakpoint
ALTER TABLE `__new_apikey` RENAME TO `apikey`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX IF EXISTS `apikey_key_idx`;--> statement-breakpoint
CREATE INDEX `apikey_configId_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_referenceId_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `apikey_key_unique` ON `apikey` (`key`);