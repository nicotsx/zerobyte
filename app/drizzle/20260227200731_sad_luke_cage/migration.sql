CREATE TABLE `sso_provider` (
	`id` text PRIMARY KEY,
	`provider_id` text NOT NULL UNIQUE,
	`organization_id` text NOT NULL,
	`user_id` text,
	`issuer` text NOT NULL,
	`domain` text NOT NULL,
	`auto_link_matching_emails` integer DEFAULT false NOT NULL,
	`oidc_config` text,
	`saml_config` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT `fk_sso_provider_organization_id_organization_id_fk` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_sso_provider_user_id_users_table_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users_table`(`id`) ON DELETE SET NULL
);
