-- Convert timestamps from seconds to milliseconds (multiply by 1000)
-- Only convert values that appear to be in seconds (less than year 2100 threshold)

UPDATE `volumes_table` SET `last_health_check` = `last_health_check` * 1000 WHERE `last_health_check` < 4102444800;
--> statement-breakpoint
UPDATE `volumes_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `volumes_table` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;
--> statement-breakpoint

UPDATE `users_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `users_table` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;
--> statement-breakpoint

UPDATE `sessions_table` SET `expires_at` = `expires_at` * 1000 WHERE `expires_at` < 4102444800;
--> statement-breakpoint
UPDATE `sessions_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint

UPDATE `repositories_table` SET `last_checked` = `last_checked` * 1000 WHERE `last_checked` < 4102444800;
--> statement-breakpoint
UPDATE `repositories_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `repositories_table` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;
--> statement-breakpoint

UPDATE `backup_schedules_table` SET `last_backup_at` = `last_backup_at` * 1000 WHERE `last_backup_at` < 4102444800;
--> statement-breakpoint
UPDATE `backup_schedules_table` SET `next_backup_at` = `next_backup_at` * 1000 WHERE `next_backup_at` < 4102444800;
--> statement-breakpoint
UPDATE `backup_schedules_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `backup_schedules_table` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;
--> statement-breakpoint

UPDATE `notification_destinations_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `notification_destinations_table` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;
--> statement-breakpoint

UPDATE `backup_schedule_notifications_table` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint

UPDATE `app_metadata` SET `created_at` = `created_at` * 1000 WHERE `created_at` < 4102444800;
--> statement-breakpoint
UPDATE `app_metadata` SET `updated_at` = `updated_at` * 1000 WHERE `updated_at` < 4102444800;-