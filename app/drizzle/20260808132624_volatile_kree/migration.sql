ALTER TABLE `agents_table` ADD `credential_hash` text;--> statement-breakpoint
ALTER TABLE `agents_table` ADD `credential_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `agents_table` ADD `revoked_at` integer;