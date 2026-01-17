-- Backfill organization_id for volumes, backups, notifications and repositories
-- Uses the first organization found in the database

-- Update volumes_table
UPDATE volumes_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;

-- Update backup_schedules_table
UPDATE backup_schedules_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;

-- Update notification_destinations_table
UPDATE notification_destinations_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;

-- Update repositories_table
UPDATE repositories_table
SET organization_id = (SELECT id FROM organization ORDER BY created_at ASC LIMIT 1)
WHERE organization_id IS NULL;
