ALTER TABLE `sso_provider` ADD `auto_link_matching_emails` integer DEFAULT true NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sso_provider` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`auto_link_matching_emails` integer DEFAULT true NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_sso_provider_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_provider_user_id_users_table_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
INSERT INTO `__new_sso_provider`(`id`, `provider_id`, `organization_id`, `user_id`, `issuer`, `domain`, `oidc_config`, `saml_config`, `created_at`, `updated_at`) SELECT `id`, `provider_id`, `organization_id`, `user_id`, `issuer`, `domain`, `oidc_config`, `saml_config`, `created_at`, `updated_at` FROM `sso_provider`;--> statement-breakpoint
DROP TABLE `sso_provider`;--> statement-breakpoint
ALTER TABLE `__new_sso_provider` RENAME TO `sso_provider`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_provider_id_uidx` ON `sso_provider` (`provider_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sso_provider_organization_id_uidx` ON `sso_provider` (`organization_id`);--> statement-breakpoint
CREATE INDEX `sso_provider_domain_idx` ON `sso_provider` (`domain`);