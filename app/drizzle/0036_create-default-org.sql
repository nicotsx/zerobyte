INSERT INTO organization (id, name, slug, created_at)
SELECT
    'default-org-' || u.id as id,
    u.name || '''s Workspace' as name,
    lower(replace(u.name, ' ', '-')) || '-' || lower(hex(randomblob(2))) as slug,
    strftime('%s', 'now') * 1000 as created_at
FROM users_table u
LEFT JOIN member m ON u.id = m.user_id
WHERE m.user_id IS NULL;
