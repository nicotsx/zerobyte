-- Custom SQL migration file, put your code below! --
INSERT INTO member (id, organization_id, user_id, role, created_at)
SELECT
    'default-mem-' || u.id as id,
    'default-org-' || u.id as organization_id,
    u.id as user_id,
    'owner' as role,
    strftime('%s', 'now') * 1000 as created_at
FROM users_table u
LEFT JOIN member m ON u.id = m.user_id
WHERE m.user_id IS NULL;
