UPDATE volumes_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;
--> statement-breakpoint
UPDATE backup_schedules_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;
--> statement-breakpoint
UPDATE notification_destinations_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;
--> statement-breakpoint
UPDATE repositories_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;
